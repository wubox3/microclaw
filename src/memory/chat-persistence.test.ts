import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createChatPersistence, type ChatPersistence } from "./chat-persistence.js";
import { MEMORY_SCHEMA, FTS_SYNC_TRIGGERS, CHAT_SCHEMA } from "./memory-schema.js";
import type { EmbeddingProvider } from "./embeddings.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(MEMORY_SCHEMA);
  db.exec(FTS_SYNC_TRIGGERS);
  db.exec(CHAT_SCHEMA);
  return db;
}

function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    model: "test-model",
    dimensions: 4,
    embed: vi.fn().mockResolvedValue([
      { embedding: [0.1, 0.2, 0.3, 0.4], model: "test-model", dimensions: 4 },
    ]),
  };
}

function queryAll(db: DatabaseSync, sql: string, ...params: unknown[]): unknown[] {
  return db.prepare(sql).all(...params);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createChatPersistence", () => {
  let db: DatabaseSync;
  let persistence: ChatPersistence;

  beforeEach(() => {
    db = createTestDb();
    persistence = createChatPersistence({ db });
  });

  afterEach(() => {
    db.close();
  });

  describe("saveExchange", () => {
    it("inserts user and assistant messages into chat_messages", async () => {
      await persistence.saveExchange({
        channelId: "web",
        userMessage: "Hello",
        assistantMessage: "Hi there!",
        timestamp: 1000,
      });

      const rows = queryAll(db, "SELECT channel_id, role, content, timestamp FROM chat_messages ORDER BY id") as Array<{
        channel_id: string;
        role: string;
        content: string;
        timestamp: number;
      }>;

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ channel_id: "web", role: "user", content: "Hello", timestamp: 1000 });
      expect(rows[1]).toMatchObject({ channel_id: "web", role: "assistant", content: "Hi there!", timestamp: 1001 });
    });

    it("creates a memory_file with source='chat'", async () => {
      await persistence.saveExchange({
        channelId: "web",
        userMessage: "Test",
        assistantMessage: "Response",
        timestamp: 2000,
      });

      const files = queryAll(db, "SELECT path, source FROM memory_files") as Array<{
        path: string;
        source: string;
      }>;

      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({ path: "chat/web/2000", source: "chat" });
    });

    it("creates memory_chunks with combined exchange content", async () => {
      await persistence.saveExchange({
        channelId: "web",
        userMessage: "Question",
        assistantMessage: "Answer",
        timestamp: 3000,
      });

      const chunks = queryAll(db, "SELECT content FROM memory_chunks") as Array<{ content: string }>;

      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.content).toBe("User: Question\n\nAssistant: Answer");
    });

    it("links chat_messages to memory_file via memory_file_id", async () => {
      await persistence.saveExchange({
        channelId: "web",
        userMessage: "Msg",
        assistantMessage: "Reply",
        timestamp: 4000,
      });

      const files = queryAll(db, "SELECT id FROM memory_files") as Array<{ id: number }>;
      const messages = queryAll(db, "SELECT memory_file_id FROM chat_messages") as Array<{ memory_file_id: number }>;

      expect(files).toHaveLength(1);
      expect(messages).toHaveLength(2);
      expect(messages[0]!.memory_file_id).toBe(files[0]!.id);
      expect(messages[1]!.memory_file_id).toBe(files[0]!.id);
    });

    it("populates FTS5 index for keyword search", async () => {
      await persistence.saveExchange({
        channelId: "web",
        userMessage: "What is photosynthesis?",
        assistantMessage: "Photosynthesis is the process plants use.",
        timestamp: 5000,
      });

      const ftsResults = queryAll(
        db,
        "SELECT mc.content FROM memory_chunks_fts fts JOIN memory_chunks mc ON fts.rowid = mc.id WHERE memory_chunks_fts MATCH ?",
        '"photosynthesis"',
      ) as Array<{ content: string }>;

      expect(ftsResults).toHaveLength(1);
      expect(ftsResults[0]!.content).toContain("photosynthesis");
    });

    it("stores multiple exchanges with different channels", async () => {
      await persistence.saveExchange({
        channelId: "web",
        userMessage: "Web msg",
        assistantMessage: "Web reply",
        timestamp: 6000,
      });

      await persistence.saveExchange({
        channelId: "telegram",
        userMessage: "Telegram msg",
        assistantMessage: "Telegram reply",
        timestamp: 7000,
      });

      const webMsgs = queryAll(db, "SELECT id FROM chat_messages WHERE channel_id = 'web'");
      const telegramMsgs = queryAll(db, "SELECT id FROM chat_messages WHERE channel_id = 'telegram'");

      expect(webMsgs).toHaveLength(2);
      expect(telegramMsgs).toHaveLength(2);
    });

    it("rolls back all writes on failure (transaction atomicity)", async () => {
      // Cause a unique constraint violation on memory_files.path
      db.prepare("INSERT INTO memory_files (path, source, hash) VALUES ('chat/web/8000', 'chat', 'existing')").run();

      await expect(
        persistence.saveExchange({
          channelId: "web",
          userMessage: "Fail",
          assistantMessage: "Should rollback",
          timestamp: 8000,
        }),
      ).rejects.toThrow();

      const messages = queryAll(db, "SELECT id FROM chat_messages");
      const chunks = queryAll(db, "SELECT id FROM memory_chunks");

      expect(messages).toHaveLength(0);
      expect(chunks).toHaveLength(0);
    });
  });

  describe("saveExchange with embedding provider", () => {
    it("triggers embedding generation after commit", async () => {
      const mockProvider = createMockEmbeddingProvider();
      const persistenceWithEmbed = createChatPersistence({ db, embeddingProvider: mockProvider });

      await persistenceWithEmbed.saveExchange({
        channelId: "web",
        userMessage: "Embed this",
        assistantMessage: "Sure",
        timestamp: 9000,
      });

      // Wait for fire-and-forget embedding to complete
      await vi.waitFor(() => {
        expect(mockProvider.embed).toHaveBeenCalledTimes(1);
      });

      const embeddings = queryAll(db, "SELECT chunk_id, provider_model, dimensions FROM embedding_cache") as Array<{
        chunk_id: number;
        provider_model: string;
        dimensions: number;
      }>;

      expect(embeddings).toHaveLength(1);
      expect(embeddings[0]!.provider_model).toBe("anthropic:test-model");
      expect(embeddings[0]!.dimensions).toBe(4);
    });

    it("does not block save when embedding generation fails", async () => {
      const mockProvider = createMockEmbeddingProvider();
      (mockProvider.embed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("API down"));
      const persistenceWithEmbed = createChatPersistence({ db, embeddingProvider: mockProvider });

      await persistenceWithEmbed.saveExchange({
        channelId: "web",
        userMessage: "Still saves",
        assistantMessage: "Yes",
        timestamp: 10000,
      });

      // Messages should be saved despite embedding failure
      const messages = queryAll(db, "SELECT id FROM chat_messages");
      expect(messages).toHaveLength(2);
    });
  });

  describe("loadHistory", () => {
    beforeEach(async () => {
      // Seed 6 messages (3 exchanges)
      await persistence.saveExchange({ channelId: "web", userMessage: "First", assistantMessage: "Reply 1", timestamp: 1000 });
      await persistence.saveExchange({ channelId: "web", userMessage: "Second", assistantMessage: "Reply 2", timestamp: 2000 });
      await persistence.saveExchange({ channelId: "web", userMessage: "Third", assistantMessage: "Reply 3", timestamp: 3000 });
    });

    it("returns messages in chronological order", async () => {
      const history = await persistence.loadHistory({ channelId: "web" });

      expect(history).toHaveLength(6);
      expect(history[0]!.content).toBe("First");
      expect(history[0]!.role).toBe("user");
      expect(history[1]!.content).toBe("Reply 1");
      expect(history[1]!.role).toBe("assistant");
      expect(history[5]!.content).toBe("Reply 3");
    });

    it("defaults to channelId 'web'", async () => {
      const history = await persistence.loadHistory({});

      expect(history).toHaveLength(6);
      expect(history.every((m) => m.channelId === "web")).toBe(true);
    });

    it("respects limit parameter", async () => {
      const history = await persistence.loadHistory({ channelId: "web", limit: 2 });

      // Should return the 2 most recent messages (DESC then reverse)
      expect(history).toHaveLength(2);
      expect(history[0]!.content).toBe("Third");
      expect(history[1]!.content).toBe("Reply 3");
    });

    it("supports before cursor for pagination", async () => {
      const history = await persistence.loadHistory({ channelId: "web", before: 2000 });

      // Should return messages with timestamp < 2000
      expect(history).toHaveLength(2);
      expect(history[0]!.content).toBe("First");
      expect(history[1]!.content).toBe("Reply 1");
    });

    it("filters by channel_id", async () => {
      await persistence.saveExchange({ channelId: "telegram", userMessage: "Tg", assistantMessage: "Tg reply", timestamp: 4000 });

      const webHistory = await persistence.loadHistory({ channelId: "web" });
      const tgHistory = await persistence.loadHistory({ channelId: "telegram" });

      expect(webHistory).toHaveLength(6);
      expect(tgHistory).toHaveLength(2);
    });

    it("returns empty array when no messages exist for channel", async () => {
      const history = await persistence.loadHistory({ channelId: "discord" });

      expect(history).toEqual([]);
    });

    it("returns correct ChatMessageRecord shape", async () => {
      const history = await persistence.loadHistory({ channelId: "web", limit: 1 });

      expect(history).toHaveLength(1);
      const msg = history[0]!;
      expect(msg).toHaveProperty("id");
      expect(msg).toHaveProperty("channelId");
      expect(msg).toHaveProperty("role");
      expect(msg).toHaveProperty("content");
      expect(msg).toHaveProperty("timestamp");
      expect(msg).toHaveProperty("memoryFileId");
      expect(msg).toHaveProperty("createdAt");
      expect(typeof msg.id).toBe("number");
      expect(typeof msg.memoryFileId).toBe("number");
    });

    it("combines limit and before for windowed pagination", async () => {
      const history = await persistence.loadHistory({ channelId: "web", limit: 2, before: 3000 });

      // Messages with timestamp < 3000, limit 2, ASC order
      expect(history).toHaveLength(2);
      // The before query uses ASC, so it returns the first 2 matching
      expect(history[0]!.content).toBe("First");
      expect(history[1]!.content).toBe("Reply 1");
    });
  });
});
