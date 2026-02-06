import type { MicroClawConfig } from "../config/types.js";

export type MemoryBackendConfig = {
  dataDir: string;
  dbPath: string;
  embeddingModel: string;
  vectorWeight: number;
  keywordWeight: number;
  maxResults: number;
};

export function resolveMemoryBackendConfig(config: MicroClawConfig, dataDir: string): MemoryBackendConfig {
  return {
    dataDir,
    dbPath: `${dataDir}/memory.db`,
    embeddingModel: config.memory?.embeddingModel ?? "voyage-3",
    vectorWeight: config.memory?.vectorWeight ?? 0.7,
    keywordWeight: config.memory?.keywordWeight ?? 0.3,
    maxResults: config.memory?.maxResults ?? 10,
  };
}
