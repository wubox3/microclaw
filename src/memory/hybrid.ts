import type { MemorySearchResult } from "./types.js";

export type VectorSearchResult = {
  chunkId: number;
  fileId: number;
  filePath: string;
  source: string;
  content: string;
  snippet: string;
  startLine: number;
  endLine: number;
  score: number;
};

export type KeywordSearchResult = {
  chunkId: number;
  fileId: number;
  filePath: string;
  source: string;
  content: string;
  snippet: string;
  startLine: number;
  endLine: number;
  bm25Score: number;
};

export function mergeSearchResults(params: {
  vectorResults: VectorSearchResult[];
  keywordResults: KeywordSearchResult[];
  vectorWeight: number;
  keywordWeight: number;
  limit: number;
}): MemorySearchResult[] {
  const { vectorResults, keywordResults, vectorWeight, keywordWeight, limit } = params;
  const merged = new Map<number, MemorySearchResult>();

  // Normalize BM25 scores to 0-1 range
  let maxBm25 = 1;
  for (const r of keywordResults) {
    if (r.bm25Score > maxBm25) {
      maxBm25 = r.bm25Score;
    }
  }

  for (const vr of vectorResults) {
    merged.set(vr.chunkId, {
      chunkId: vr.chunkId,
      fileId: vr.fileId,
      filePath: vr.filePath,
      source: vr.source,
      content: vr.content,
      snippet: vr.snippet,
      startLine: vr.startLine,
      endLine: vr.endLine,
      vectorScore: vr.score,
      textScore: 0,
      combinedScore: vr.score * vectorWeight,
    });
  }

  for (const kr of keywordResults) {
    const normalizedScore = kr.bm25Score / maxBm25;
    const existing = merged.get(kr.chunkId);
    if (existing) {
      merged.set(kr.chunkId, {
        ...existing,
        textScore: normalizedScore,
        combinedScore: existing.vectorScore * vectorWeight + normalizedScore * keywordWeight,
        snippet: existing.snippet || kr.snippet,
      });
    } else {
      merged.set(kr.chunkId, {
        chunkId: kr.chunkId,
        fileId: kr.fileId,
        filePath: kr.filePath,
        source: kr.source,
        content: kr.content,
        snippet: kr.snippet,
        startLine: kr.startLine,
        endLine: kr.endLine,
        vectorScore: 0,
        textScore: normalizedScore,
        combinedScore: normalizedScore * keywordWeight,
      });
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit);
}

export function buildFtsQuery(query: string): string {
  const tokens = query
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) {
    // Sanitize: strip all non-alphanumeric to avoid FTS5 syntax errors
    const sanitized = query.replace(/[^\w\s]/g, "").trim();
    if (sanitized.length === 0) {
      return "";
    }
    return `"${sanitized}"`;
  }
  return tokens.map((t) => `"${t}"`).join(" AND ");
}
