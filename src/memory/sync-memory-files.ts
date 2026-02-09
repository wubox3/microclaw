import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { resolve, relative } from "node:path";
import type { SqliteDb } from "./sqlite.js";
import { hashContent, chunkText } from "./internal.js";
import { withTransaction } from "./sqlite.js";
import { createLogger } from "../logging.js";

const log = createLogger("sync-memory");

export function syncMemoryFiles(
  db: SqliteDb,
  dir: string,
): { added: number; updated: number; removed: number } {
  let added = 0;
  let updated = 0;
  let removed = 0;

  const MAX_FILE_COUNT = 1000;
  const MAX_FILE_SIZE_BYTES = 1_048_576; // 1MB per file

  // Sort deterministically before truncating to prevent nondeterministic inclusion
  const sortedFiles = collectFiles(dir).sort((a, b) => a.path.localeCompare(b.path));

  // Enforce file count limit to prevent OOM (immutable slice instead of .length mutation)
  if (sortedFiles.length > MAX_FILE_COUNT) {
    log.warn(`Memory sync truncated: ${sortedFiles.length} files found, limit is ${MAX_FILE_COUNT}`);
  }
  const currentFiles = sortedFiles.length > MAX_FILE_COUNT
    ? sortedFiles.slice(0, MAX_FILE_COUNT)
    : sortedFiles;

  // Read all file contents BEFORE opening the transaction to avoid holding
  // the SQLite write lock during synchronous I/O
  const fileContents = new Map<string, { content: string; hash: string }>();
  for (const file of currentFiles) {
    const fullPath = resolve(dir, file.path);
    const fileStat = lstatSync(fullPath);
    // Skip symlinks (defense against TOCTOU symlink swap between collectFiles and here)
    if (fileStat.isSymbolicLink()) {
      continue;
    }
    // Skip files exceeding the size limit to prevent OOM
    if (fileStat.size > MAX_FILE_SIZE_BYTES) {
      continue;
    }
    try {
      const content = readFileSync(fullPath, "utf-8");
      fileContents.set(file.path, { content, hash: hashContent(content) });
    } catch {
      // Skip files that became unreadable between stat and read
    }
  }

  const existingFiles = db.prepare("SELECT id, path, hash FROM memory_files WHERE source = 'file'").all() as Array<{
    id: number;
    path: string;
    hash: string;
  }>;

  const existingByPath = new Map(existingFiles.map((f) => [f.path, f]));
  const currentPaths = new Set(currentFiles.filter((f) => fileContents.has(f.path)).map((f) => f.path));

  const deleteFileStmt = db.prepare("DELETE FROM memory_files WHERE id = ?");
  const deleteChunksStmt = db.prepare("DELETE FROM memory_chunks WHERE file_id = ?");
  const updateFileStmt = db.prepare("UPDATE memory_files SET hash = ?, updated_at = unixepoch() WHERE id = ?");
  const insertChunkStmt = db.prepare("INSERT INTO memory_chunks (file_id, content, start_line, end_line, hash) VALUES (?, ?, ?, ?, ?)");

  withTransaction(db, () => {
    // Remove files no longer present (CASCADE deletes chunks and embeddings)
    for (const existing of existingFiles) {
      if (!currentPaths.has(existing.path)) {
        deleteFileStmt.run(existing.id);
        removed++;
      }
    }

    // Add or update files
    for (const file of currentFiles) {
      const entry = fileContents.get(file.path);
      if (!entry) continue; // skip oversized files
      const existing = existingByPath.get(file.path);

      if (!existing) {
        insertFile(db, file.path, "file", entry.hash, entry.content, insertChunkStmt);
        added++;
      } else if (existing.hash !== entry.hash) {
        // CASCADE on memory_chunks deletes embedding_cache entries automatically
        deleteChunksStmt.run(existing.id);
        updateFileStmt.run(entry.hash, existing.id);
        insertChunks(db, existing.id, entry.content, insertChunkStmt);
        updated++;
      }
    }
  });

  return { added, updated, removed };
}

function collectFiles(dir: string): Array<{ path: string }> {
  const files: Array<{ path: string }> = [];
  try {
    const MAX_ENTRIES = 10_000;
    const entries = readdirSync(dir, { recursive: true, encoding: "utf-8" });
    if (entries.length > MAX_ENTRIES) {
      log.warn(`Directory scan truncated: ${entries.length} entries found, limit is ${MAX_ENTRIES}`);
    }
    const limitedEntries = entries.slice(0, MAX_ENTRIES);
    for (const entry of limitedEntries) {
      const fullPath = resolve(dir, entry);
      // Skip paths that escape the data directory (e.g. via symlinked subdirectories)
      if (!fullPath.startsWith(dir + "/") && fullPath !== dir) {
        continue;
      }
      try {
        const stat = lstatSync(fullPath);
        if (stat.isSymbolicLink()) {
          continue;
        }
        if (stat.isFile() && isTextFile(entry)) {
          files.push({ path: entry.replace(/\\/g, "/") });
        }
      } catch {
        // skip inaccessible files
      }
    }
  } catch (err) {
    // Log directory access errors rather than silently returning empty
    if (err instanceof Error && (err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
  return files;
}

function isTextFile(path: string): boolean {
  const textExtensions = [
    ".txt", ".md", ".ts", ".js", ".json", ".yaml", ".yml", ".toml", ".csv",
    ".html", ".css", ".py", ".go", ".rs", ".java", ".sh", ".rb", ".php",
    ".sql", ".xml", ".ini", ".cfg",
  ];
  return textExtensions.some((ext) => path.endsWith(ext));
}

function insertFile(db: SqliteDb, path: string, source: string, hash: string, content: string, insertChunkStmt: ReturnType<SqliteDb["prepare"]>): void {
  const result = db.prepare(
    "INSERT INTO memory_files (path, source, hash) VALUES (?, ?, ?)"
  ).run(path, source, hash);
  const fileId = (result as unknown as { lastInsertRowid: number }).lastInsertRowid;
  insertChunks(db, fileId, content, insertChunkStmt);
}

function insertChunks(db: SqliteDb, fileId: number, content: string, insertChunkStmt: ReturnType<SqliteDb["prepare"]>): void {
  const chunks = chunkText(content);
  let searchFrom = 0;

  for (const chunk of chunks) {
    const pos = content.indexOf(chunk, searchFrom);
    if (pos < 0) {
      log.warn(`Chunk not found in content (searchFrom=${searchFrom}, chunkLen=${chunk.length})`);
    }
    const startLine = pos >= 0
      ? content.slice(0, pos).split("\n").length - 1
      : searchFrom > 0 ? content.slice(0, searchFrom).split("\n").length - 1 : 0;
    const chunkLineCount = chunk.split("\n").length;
    const hash = hashContent(chunk);
    insertChunkStmt.run(fileId, chunk, startLine, startLine + chunkLineCount - 1, hash);
    if (pos >= 0) {
      searchFrom = pos + chunk.length;
    }
  }
}
