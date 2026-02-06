import type { SqliteDb } from "./sqlite.js";
import { hashContent, chunkText } from "./internal.js";

export function syncSessionContent(
  db: SqliteDb,
  sessionKey: string,
  content: string,
): void {
  const path = `session:${sessionKey}`;
  const hash = hashContent(content);

  const existing = db.prepare("SELECT id, hash FROM memory_files WHERE path = ?").get(path) as
    | { id: number; hash: string }
    | undefined;

  if (existing && existing.hash === hash) {
    return;
  }

  if (existing) {
    db.prepare("DELETE FROM memory_chunks WHERE file_id = ?").run(existing.id);
    db.prepare("UPDATE memory_files SET hash = ?, updated_at = unixepoch() WHERE id = ?").run(hash, existing.id);
    insertSessionChunks(db, existing.id, content);
  } else {
    const result = db.prepare(
      "INSERT INTO memory_files (path, source, hash) VALUES (?, 'session', ?)"
    ).run(path, hash);
    const fileId = (result as unknown as { lastInsertRowid: number }).lastInsertRowid;
    insertSessionChunks(db, fileId, content);
  }
}

function insertSessionChunks(db: SqliteDb, fileId: number, content: string): void {
  const chunks = chunkText(content);
  let lineOffset = 0;

  for (const chunk of chunks) {
    const chunkLines = chunk.split("\n").length;
    const hash = hashContent(chunk);
    db.prepare(
      "INSERT INTO memory_chunks (file_id, content, start_line, end_line, hash) VALUES (?, ?, ?, ?, ?)"
    ).run(fileId, chunk, lineOffset, lineOffset + chunkLines - 1, hash);
    lineOffset += chunkLines;
  }
}
