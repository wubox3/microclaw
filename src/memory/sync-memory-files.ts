import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import type { SqliteDb } from "./sqlite.js";
import { hashContent, chunkText } from "./internal.js";

export function syncMemoryFiles(
  db: SqliteDb,
  dir: string,
): { added: number; updated: number; removed: number } {
  let added = 0;
  let updated = 0;
  let removed = 0;

  const currentFiles = collectFiles(dir);
  const existingFiles = db.prepare("SELECT id, path, hash FROM memory_files").all() as Array<{
    id: number;
    path: string;
    hash: string;
  }>;

  const existingByPath = new Map(existingFiles.map((f) => [f.path, f]));
  const currentPaths = new Set(currentFiles.map((f) => f.path));

  db.exec("BEGIN");
  try {
    // Remove files no longer present (CASCADE deletes chunks and embeddings)
    for (const existing of existingFiles) {
      if (!currentPaths.has(existing.path)) {
        db.prepare("DELETE FROM memory_files WHERE id = ?").run(existing.id);
        removed++;
      }
    }

    // Add or update files
    for (const file of currentFiles) {
      const content = readFileSync(resolve(dir, file.path), "utf-8");
      const hash = hashContent(content);
      const existing = existingByPath.get(file.path);

      if (!existing) {
        insertFile(db, file.path, "file", hash, content);
        added++;
      } else if (existing.hash !== hash) {
        // CASCADE on memory_chunks deletes embedding_cache entries automatically
        db.prepare("DELETE FROM memory_chunks WHERE file_id = ?").run(existing.id);
        db.prepare("UPDATE memory_files SET hash = ?, updated_at = unixepoch() WHERE id = ?").run(hash, existing.id);
        insertChunks(db, existing.id, content);
        updated++;
      }
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { added, updated, removed };
}

function collectFiles(dir: string): Array<{ path: string }> {
  const files: Array<{ path: string }> = [];
  try {
    const entries = readdirSync(dir, { recursive: true }) as string[];
    for (const entry of entries) {
      const fullPath = resolve(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && isTextFile(entry)) {
          files.push({ path: entry });
        }
      } catch {
        // skip inaccessible files
      }
    }
  } catch {
    // directory doesn't exist or not readable
  }
  return files;
}

function isTextFile(path: string): boolean {
  const textExtensions = [".txt", ".md", ".ts", ".js", ".json", ".yaml", ".yml", ".toml", ".csv"];
  return textExtensions.some((ext) => path.endsWith(ext));
}

function insertFile(db: SqliteDb, path: string, source: string, hash: string, content: string): void {
  const result = db.prepare(
    "INSERT INTO memory_files (path, source, hash) VALUES (?, ?, ?)"
  ).run(path, source, hash);
  const fileId = (result as unknown as { lastInsertRowid: number }).lastInsertRowid;
  insertChunks(db, fileId, content);
}

function insertChunks(db: SqliteDb, fileId: number, content: string): void {
  const chunks = chunkText(content);
  let searchFrom = 0;

  for (const chunk of chunks) {
    const pos = content.indexOf(chunk, searchFrom);
    const startLine = pos >= 0
      ? content.slice(0, pos).split("\n").length - 1
      : 0;
    const chunkLineCount = chunk.split("\n").length;
    const hash = hashContent(chunk);
    db.prepare(
      "INSERT INTO memory_chunks (file_id, content, start_line, end_line, hash) VALUES (?, ?, ?, ?, ?)"
    ).run(fileId, chunk, startLine, startLine + chunkLineCount - 1, hash);
    if (pos >= 0) {
      searchFrom = pos + 1;
    }
  }
}
