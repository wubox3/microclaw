import { randomUUID } from "node:crypto";
import type { SqliteDb } from "./sqlite.js";
import type { EmbeddingProvider } from "./embeddings.js";
import type { ChatMessageRecord } from "./types.js";
import { hashContent, chunkText } from "./internal.js";
import { providerKey } from "./embeddings.js";
import { withTransaction } from "./sqlite.js";
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
  close: () => Promise<void>;
};

export function createChatPersistence(params: {
  db: SqliteDb;
  embeddingProvider?: EmbeddingProvider;
}): ChatPersistence {
  const { db, embeddingProvider } = params;

  // Serialize concurrent saveExchange calls to prevent interleaved transactions
  let saveQueue: Promise<void> = Promise.resolve();
  let closed = false;

  return {
    saveExchange: async ({ channelId, userMessage, assistantMessage, timestamp }) => {
      if (!channelId || typeof channelId !== "string" || channelId.includes("/") || channelId.includes("\\")) {
        throw new Error(`Invalid channelId: ${channelId}`);
      }

      const doSave = async () => {
        if (closed) return;
        const exchangeContent = `User: ${userMessage}\n\nAssistant: ${assistantMessage}`;
        const hash = hashContent(exchangeContent);
        const chatPath = `chat/${channelId}/${timestamp}-${randomUUID().slice(0, 8)}`;

        // Wrap all writes in a savepoint for atomicity (allows nesting)
        const fileId = withTransaction(db, () => {
          const fileResult = db.prepare(
            "INSERT INTO memory_files (path, source, hash) VALUES (?, 'chat', ?)",
          ).run(chatPath, hash);
          const fId = (fileResult as unknown as { lastInsertRowid: number }).lastInsertRowid;

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
            ).run(fId, chunk, startLine, startLine + chunkLineCount - 1, chunkHash);
            if (pos >= 0) {
              searchFrom = pos + chunk.length;
            }
          }

          // Insert into chat_messages for chronological history
          db.prepare(
            "INSERT INTO chat_messages (channel_id, role, content, timestamp, memory_file_id) VALUES (?, 'user', ?, ?, ?)",
          ).run(channelId, userMessage, timestamp, fId);

          // Use +0.5 offset to maintain ordering without colliding with rapid messages (timestamps are in seconds)
          db.prepare(
            "INSERT INTO chat_messages (channel_id, role, content, timestamp, memory_file_id) VALUES (?, 'assistant', ?, ?, ?)",
          ).run(channelId, assistantMessage, timestamp + 0.5, fId);

          return fId;
        });

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
      saveQueue = queued.catch((err) => {
        log.error(`saveExchange failed: ${err instanceof Error ? err.message : String(err)}`);
      });
      return queued;
    },

    close: async () => {
      closed = true;
      await saveQueue;
    },

    loadHistory: async ({ channelId = "web", limit = 50, before }) => {
      const safeLimit = Math.max(1, Math.min(limit ?? 50, 1000));

      // Always query DESC to get the most recent N messages (optionally before a cursor),
      // then reverse to chronological ASC order for the caller.
      const query = before
        ? "SELECT id, channel_id, role, content, timestamp, memory_file_id, created_at FROM chat_messages WHERE channel_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?"
        : "SELECT id, channel_id, role, content, timestamp, memory_file_id, created_at FROM chat_messages WHERE channel_id = ? ORDER BY timestamp DESC LIMIT ?";

      const params = before
        ? [channelId, before, safeLimit]
        : [channelId, safeLimit];

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

  withTransaction(db, () => {
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
  });
}
