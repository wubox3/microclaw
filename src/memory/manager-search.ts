import type { SqliteDb } from "./sqlite.js";
import type { MemorySearchParams } from "./types.js";
import type { VectorSearchResult, KeywordSearchResult } from "./hybrid.js";
import { buildFtsQuery } from "./hybrid.js";
import { cosineSimilarity, truncateSnippet } from "./internal.js";
import { createLogger } from "../logging.js";

const searchLog = createLogger("memory-search");

export function vectorSearch(
  db: SqliteDb,
  queryEmbedding: number[],
  providerModel: string,
  params: { limit?: number; source?: string },
): VectorSearchResult[] {
  const limit = params.limit ?? 10;

  const MAX_VECTOR_CANDIDATES = 1000;

  // Fetch embeddings for the provider model and compute similarity in JS
  const stmt = db.prepare(`
    SELECT
      ec.chunk_id,
      ec.embedding,
      mc.content,
      mc.start_line,
      mc.end_line,
      mc.file_id,
      mf.path,
      mf.source
    FROM embedding_cache ec
    JOIN memory_chunks mc ON mc.id = ec.chunk_id
    JOIN memory_files mf ON mf.id = mc.file_id
    WHERE ec.provider_model = ?
    ${params.source ? "AND mf.source = ?" : ""}
    ORDER BY ec.created_at DESC
    LIMIT ?
  `);

  const args: (string | number | null)[] = [providerModel];
  if (params.source) {
    args.push(params.source);
  }
  args.push(MAX_VECTOR_CANDIDATES);

  const rows = stmt.all(...args) as Array<{
    chunk_id: number;
    embedding: Buffer;
    content: string;
    start_line: number;
    end_line: number;
    file_id: number;
    path: string;
    source: string;
  }>;

  const results = rows.map((row): VectorSearchResult | null => {
    // Copy into an aligned ArrayBuffer — Node.js Buffers can have arbitrary
    // byteOffset which would cause Float32Array to throw RangeError.
    if (row.embedding.byteLength === 0 || row.embedding.byteLength % 4 !== 0) {
      searchLog.warn(`Invalid embedding size (${row.embedding.byteLength} bytes, not aligned to float32) for chunk ${row.chunk_id}, skipping`);
      return null;
    }
    const aligned = new ArrayBuffer(row.embedding.byteLength);
    new Uint8Array(aligned).set(new Uint8Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength));
    const stored = new Float32Array(aligned);
    if (stored.length !== queryEmbedding.length) {
      searchLog.warn(`Embedding dimension mismatch: query=${queryEmbedding.length}, stored=${stored.length} for chunk ${row.chunk_id}, skipping`);
      return null;
    }
    const score = cosineSimilarity(queryEmbedding, stored);
    return {
      chunkId: row.chunk_id,
      fileId: row.file_id,
      filePath: row.path,
      source: row.source,
      content: row.content,
      snippet: truncateSnippet(row.content),
      startLine: row.start_line,
      endLine: row.end_line,
      score,
    };
  });

  return results
    .filter((r): r is VectorSearchResult => r !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function keywordSearch(
  db: SqliteDb,
  query: string,
  params: { limit?: number; source?: string },
): KeywordSearchResult[] {
  const limit = params.limit ?? 10;
  const ftsQuery = buildFtsQuery(query);

  if (ftsQuery === "") {
    return [];
  }

  try {
    const stmt = db.prepare(`
      SELECT
        mc.id AS chunk_id,
        mc.file_id,
        mc.content,
        mc.start_line,
        mc.end_line,
        mf.path,
        mf.source,
        rank AS bm25_score
      FROM memory_chunks_fts
      JOIN memory_chunks mc ON mc.id = memory_chunks_fts.rowid
      JOIN memory_files mf ON mf.id = mc.file_id
      WHERE memory_chunks_fts MATCH ?
      ${params.source ? "AND mf.source = ?" : ""}
      ORDER BY rank
      LIMIT ?
    `);

    const args: (string | number | null)[] = [ftsQuery];
    if (params.source) {
      args.push(params.source);
    }
    args.push(limit);

    const rows = stmt.all(...args) as Array<{
      chunk_id: number;
      file_id: number;
      content: string;
      start_line: number;
      end_line: number;
      path: string;
      source: string;
      bm25_score: number;
    }>;

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      fileId: row.file_id,
      filePath: row.path,
      source: row.source,
      content: row.content,
      snippet: truncateSnippet(row.content),
      startLine: row.start_line,
      endLine: row.end_line,
      bm25Score: Math.abs(row.bm25_score),
    }));
  } catch (err) {
    searchLog.warn(`FTS5 keyword search failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
