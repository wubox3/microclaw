import { mkdirSync, existsSync } from "node:fs";
import type { MicroClawConfig } from "../config/types.js";
import type { AuthCredentials } from "../infra/auth.js";
import type { MemorySearchManager, MemorySearchParams, MemorySearchResult, MemoryProviderStatus } from "./types.js";
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
  let closed = false;

  return {
    search: async (searchParams: MemorySearchParams): Promise<MemorySearchResult[]> => {
      if (closed) {
        throw new Error("Memory manager is closed");
      }

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
    },

    getStatus: async (): Promise<MemoryProviderStatus> => ({
      provider: embeddingProvider ? "anthropic" : "keyword-only",
      model: embeddingProvider?.model ?? "none",
      dimensions: embeddingProvider?.dimensions ?? 0,
      ready: !closed,
    }),

    syncFiles: async (dir: string) => {
      if (closed) {
        throw new Error("Memory manager is closed");
      }
      return syncMemoryFiles(db, dir);
    },

    saveExchange: async (params) => {
      if (closed) { throw new Error("Memory manager is closed"); }
      return chatPersistence.saveExchange(params);
    },

    loadChatHistory: async (params) => {
      if (closed) { throw new Error("Memory manager is closed"); }
      return chatPersistence.loadHistory(params);
    },

    close: () => {
      if (closed) return;
      closed = true;
      closeDatabase(db);
    },
  };
}
