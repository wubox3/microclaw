import { mkdirSync, existsSync, realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { MicroClawConfig } from "../config/types.js";
import type { AuthCredentials } from "../infra/auth.js";
import type { MemorySearchManager, MemorySearchParams, MemorySearchResult, MemoryProviderStatus, MemoryRecordCounts, UserProfile } from "./types.js";
import { createUserProfileManager } from "./user-profile.js";
import { createLogger } from "../logging.js";
import { openDatabase, closeDatabase } from "./sqlite.js";
import { MEMORY_SCHEMA, FTS_SYNC_TRIGGERS, CHAT_SCHEMA } from "./memory-schema.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import { createAnthropicEmbeddingProvider, providerKey, type EmbeddingProvider } from "./embeddings.js";
import { createChatPersistence } from "./chat-persistence.js";
import { vectorSearch, keywordSearch } from "./manager-search.js";
import { mergeSearchResults } from "./hybrid.js";
import { syncMemoryFiles } from "./sync-memory-files.js";

const memLog = createLogger("memory-manager");

export function createMemoryManager(params: {
  config: MicroClawConfig;
  dataDir: string;
  auth: AuthCredentials;
}): MemorySearchManager {
  const backendConfig = resolveMemoryBackendConfig(params.config, params.dataDir);

  if (!existsSync(backendConfig.dataDir)) {
    mkdirSync(backendConfig.dataDir, { recursive: true });
  }

  const db = openDatabase(backendConfig.dbPath);
  db.exec(MEMORY_SCHEMA);
  db.exec(FTS_SYNC_TRIGGERS);
  db.exec(CHAT_SCHEMA);

  // Embeddings require a Voyage API key (separate from Anthropic key)
  let embeddingProvider: EmbeddingProvider | undefined;
  let pKey: string | undefined;

  const voyageApiKey = process.env.VOYAGE_API_KEY;
  if (voyageApiKey) {
    embeddingProvider = createAnthropicEmbeddingProvider(voyageApiKey);
    pKey = providerKey(embeddingProvider);
  }

  const chatPersistence = createChatPersistence({ db, embeddingProvider });
  const profileManager = createUserProfileManager(db);
  const countAllStmt = db.prepare(
    "SELECT (SELECT COUNT(*) FROM memory_files) AS files, (SELECT COUNT(*) FROM memory_chunks) AS chunks, (SELECT COUNT(*) FROM chat_messages) AS chatMessages",
  );
  let closed = false;

  // Operation counter to prevent close() from destroying db while ops are in-flight
  let activeOps = 0;
  let activeOpsResolve: (() => void) | null = null;

  function trackAsyncOp<T>(fn: () => Promise<T>): Promise<T> {
    if (closed) { throw new Error("Memory manager is closed"); }
    activeOps++;
    return fn().finally(() => {
      activeOps--;
      if (activeOps === 0 && activeOpsResolve) {
        const resolve = activeOpsResolve;
        activeOpsResolve = null;
        resolve();
      }
    });
  }

  return {
    search: async (searchParams: MemorySearchParams): Promise<MemorySearchResult[]> => {
      return trackAsyncOp(async () => {
      if (!searchParams.query || searchParams.query.trim() === "") {
        return [];
      }

      const vectorWeight = searchParams.vectorWeight ?? backendConfig.vectorWeight;
      const keywordWeight = searchParams.keywordWeight ?? backendConfig.keywordWeight;
      const limit = searchParams.limit ?? backendConfig.maxResults;

      // Run keyword search
      const keywordResults = keywordSearch(db, searchParams.query, {
        limit: limit * 2,
        source: searchParams.source,
      });

      // Generate query embedding and run vector search (only if API key available)
      let vectorResults: import("./hybrid.js").VectorSearchResult[] = [];
      if (embeddingProvider && pKey) {
        try {
          const embedResults = await embeddingProvider.embed([searchParams.query]);
          if (embedResults.length > 0) {
            vectorResults = vectorSearch(db, embedResults[0]!.embedding, pKey, {
              limit: limit * 2,
              source: searchParams.source,
            });
          }
        } catch (err) {
          memLog.warn(`Vector search embedding failed, falling back to keyword-only: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return mergeSearchResults({
        vectorResults,
        keywordResults,
        vectorWeight: embeddingProvider ? vectorWeight : 0,
        keywordWeight: embeddingProvider ? keywordWeight : 1,
        limit,
      });
      });
    },

    getRecordCounts: async (): Promise<MemoryRecordCounts> => {
      if (closed) {
        return { files: 0, chunks: 0, chatMessages: 0 };
      }
      const row = countAllStmt.get() as { files: number; chunks: number; chatMessages: number };
      return { files: row.files, chunks: row.chunks, chatMessages: row.chatMessages };
    },

    getStatus: async (): Promise<MemoryProviderStatus> => ({
      provider: embeddingProvider ? "anthropic" : "keyword-only",
      model: embeddingProvider?.model ?? "none",
      dimensions: embeddingProvider?.dimensions ?? 0,
      ready: !closed,
    }),

    syncFiles: async (dir: string) => {
      return trackAsyncOp(async () => {
      // Validate path to prevent directory traversal (handles case-insensitive filesystems)
      let resolved: string;
      let dataRoot: string;
      try {
        resolved = realpathSync(resolvePath(dir));
        dataRoot = realpathSync(resolvePath(backendConfig.dataDir));
      } catch {
        // Fall back to resolve if paths don't exist yet
        resolved = resolvePath(dir);
        dataRoot = resolvePath(backendConfig.dataDir);
      }
      if (resolved !== dataRoot && !resolved.startsWith(dataRoot + "/")) {
        throw new Error("syncFiles directory must be within the configured data directory");
      }
      return syncMemoryFiles(db, resolved);
      });
    },

    saveExchange: async (params) => {
      return trackAsyncOp(async () => chatPersistence.saveExchange(params));
    },

    loadChatHistory: async (params) => {
      return trackAsyncOp(async () => chatPersistence.loadHistory(params));
    },

    getUserProfile: (): UserProfile | undefined => {
      if (closed) return undefined;
      return profileManager.getProfile();
    },

    updateUserProfile: async (llmClient) => {
      return trackAsyncOp(async () => profileManager.extractAndUpdateProfile(llmClient));
    },

    close: async () => {
      if (closed) return;
      closed = true;
      if (activeOps > 0) {
        await new Promise<void>(resolve => { activeOpsResolve = resolve; });
      }
      await chatPersistence.close();
      closeDatabase(db);
    },
  };
}
