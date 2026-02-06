import { mkdirSync, existsSync } from "node:fs";
import type { MicroClawConfig } from "../config/types.js";
import type { AuthCredentials } from "../infra/auth.js";
import type { MemorySearchManager, MemorySearchParams, MemorySearchResult, MemoryProviderStatus } from "./types.js";
import { openDatabase, closeDatabase } from "./sqlite.js";
import { MEMORY_SCHEMA, FTS_SYNC_TRIGGERS } from "./memory-schema.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import { createAnthropicEmbeddingProvider, providerKey, type EmbeddingProvider } from "./embeddings.js";
import { vectorSearch, keywordSearch } from "./manager-search.js";
import { mergeSearchResults } from "./hybrid.js";
import { syncMemoryFiles } from "./sync-memory-files.js";

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

  // Embeddings require an API key (Voyage API); OAuth tokens don't work with Voyage
  let embeddingProvider: EmbeddingProvider | undefined;
  let pKey: string | undefined;

  if (params.auth.apiKey) {
    embeddingProvider = createAnthropicEmbeddingProvider(params.auth.apiKey);
    pKey = providerKey(embeddingProvider);
  }

  return {
    search: async (searchParams: MemorySearchParams): Promise<MemorySearchResult[]> => {
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
        } catch {
          // Fall back to keyword-only search
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
      ready: true,
    }),

    syncFiles: async (dir: string) => syncMemoryFiles(db, dir),

    close: () => closeDatabase(db),
  };
}
