import type { SqliteDb } from "./sqlite.js";
import type { EmbeddingProvider } from "./embeddings.js";
import type { ChatMessageRecord } from "./types.js";
import { hashContent, chunkText } from "./internal.js";
import { providerKey } from "./embeddings.js";
import { createLogger } from "../logging.js";

const log = createLogger("chat-persistence");

export type ChatPersistence = {
  saveExchange: (params: {
    channelId: string;
    userMessage: string;
    assistantMessage: string;
    timestamp: number;
  }) => Promise<void>;
  loadHistory: (params: {
    channelId?: string;
    limit?: number;
    before?: number;
  }) => Promise<ChatMessageRecord[]>;
};

export function createChatPersistence(params: {
  db: SqliteDb;
  embeddingProvider?: EmbeddingProvider;
}): ChatPersistence {
  const { db, embeddingProvider } = params;

  // Serialize concurrent saveExchange calls to prevent interleaved transactions
  let saveQueue: Promise<void> = Promise.resolve();

  return {
    saveExchange: async ({ channelId, userMessage, assistantMessage, timestamp }) => {
      const doSave = async () => {
        const exchangeContent = `User: ${userMessage}\n\nAssistant: ${assistantMessage}`;
        const hash = hashContent(exchangeContent);
        const chatPath = `chat/${channelId}/${timestamp}`;

        // Wrap all writes in a transaction for atomicity
        db.exec("BEGIN");
        let fileId: number;
        try {
          const fileResult = db.prepare(
            "INSERT INTO memory_files (path, source, hash) VALUES (?, 'chat', ?)",
          ).run(chatPath, hash);
          fileId = (fileResult as unknown as { lastInsertRowid: number }).lastInsertRowid;

          // Insert chunks (auto-triggers FTS5 sync)
          const chunks = chunkText(exchangeContent);
          let searchFrom = 0;
          for (const chunk of chunks) {
            const pos = exchangeContent.indexOf(chunk, searchFrom);
            const startLine = pos >= 0
              ? exchangeContent.slice(0, pos).split("\n").length - 1
              : 0;
            const chunkLineCount = chunk.split("\n").length;
            const chunkHash = hashContent(chunk);
            db.prepare(
              "INSERT INTO memory_chunks (file_id, content, start_line, end_line, hash) VALUES (?, ?, ?, ?, ?)",
            ).run(fileId, chunk, startLine, startLine + chunkLineCount - 1, chunkHash);
            if (pos >= 0) {
              searchFrom = pos + chunk.length;
            }
          }

          // Insert into chat_messages for chronological history
          db.prepare(
            "INSERT INTO chat_messages (channel_id, role, content, timestamp, memory_file_id) VALUES (?, 'user', ?, ?, ?)",
          ).run(channelId, userMessage, timestamp, fileId);

          db.prepare(
            "INSERT INTO chat_messages (channel_id, role, content, timestamp, memory_file_id) VALUES (?, 'assistant', ?, ?, ?)",
          ).run(channelId, assistantMessage, timestamp + 1, fileId);

          db.exec("COMMIT");
        } catch (err) {
          try { db.exec("ROLLBACK"); } catch { /* ignore rollback failure */ }
          throw err;
        }

        // Await embedding generation (outside transaction) to prevent races with sync operations
        if (embeddingProvider) {
          const pKey = providerKey(embeddingProvider);
          try {
            await generateEmbeddings(db, fileId, embeddingProvider, pKey);
          } catch (err) {
            log.warn(`Embedding generation failed for file ${fileId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      };

      // Chain onto the queue so concurrent calls are serialized
      const queued = saveQueue.catch(() => {}).then(doSave);
      saveQueue = queued.catch(() => {}); // prevent unhandled rejection on the queue itself
      return queued;
    },

    loadHistory: async ({ channelId = "web", limit = 50, before }) => {
      // Always query DESC to get the most recent N messages (optionally before a cursor),
      // then reverse to chronological ASC order for the caller.
      const query = before
        ? "SELECT id, channel_id, role, content, timestamp, memory_file_id, created_at FROM chat_messages WHERE channel_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?"
        : "SELECT id, channel_id, role, content, timestamp, memory_file_id, created_at FROM chat_messages WHERE channel_id = ? ORDER BY timestamp DESC LIMIT ?";

      const params = before
        ? [channelId, before, limit]
        : [channelId, limit];

      const rows = db.prepare(query).all(...params) as Array<{
        id: number;
        channel_id: string;
        role: string;
        content: string;
        timestamp: number;
        memory_file_id: number | null;
        created_at: number;
      }>;

      const messages = rows.map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        role: row.role as "user" | "assistant",
        content: row.content,
        timestamp: row.timestamp,
        memoryFileId: row.memory_file_id,
        createdAt: row.created_at,
      }));

      // DESC gives newest-first; reverse to chronological ASC for the caller
      return [...messages].reverse();
    },
  };
}

async function generateEmbeddings(
  db: SqliteDb,
  fileId: number,
  provider: EmbeddingProvider,
  pKey: string,
): Promise<void> {
  const chunks = db.prepare(
    "SELECT id, content FROM memory_chunks WHERE file_id = ?"
  ).all(fileId) as Array<{ id: number; content: string }>;

  if (chunks.length === 0) {
    return;
  }

  const texts = chunks.map((c) => c.content);
  const embeddings = await provider.embed(texts);

  // No transaction wrapper: each INSERT OR REPLACE is idempotent and atomic.
  // Using a transaction here would risk "cannot start a transaction within a
  // transaction" if syncFiles or another operation runs concurrently on the
  // same DatabaseSync instance.
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const result = embeddings[i];
    if (result) {
      const blob = Buffer.from(new Float32Array(result.embedding).buffer);
      db.prepare(
        "INSERT OR REPLACE INTO embedding_cache (chunk_id, provider_model, embedding, dimensions) VALUES (?, ?, ?, ?)"
      ).run(chunk.id, pKey, blob, result.dimensions);
    }
  }
}
