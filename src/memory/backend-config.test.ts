import { describe, it, expect } from "vitest";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import type { MicroClawConfig } from "../config/types.js";

describe("resolveMemoryBackendConfig", () => {
  it("returns defaults when no memory config provided", () => {
    const result = resolveMemoryBackendConfig({}, "/data");
    expect(result).toEqual({
      dataDir: "/data",
      dbPath: "/data/memory.db",
      embeddingModel: "voyage-3",
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      maxResults: 10,
    });
  });

  it("applies custom overrides", () => {
    const config: MicroClawConfig = {
      memory: {
        embeddingModel: "custom-model",
        vectorWeight: 0.5,
        keywordWeight: 0.5,
        maxResults: 20,
      },
    };
    const result = resolveMemoryBackendConfig(config, "/custom");
    expect(result.embeddingModel).toBe("custom-model");
    expect(result.vectorWeight).toBe(0.5);
    expect(result.keywordWeight).toBe(0.5);
    expect(result.maxResults).toBe(20);
  });

  it("derives dbPath from dataDir", () => {
    const result = resolveMemoryBackendConfig({}, "/my/data/dir");
    expect(result.dbPath).toBe("/my/data/dir/memory.db");
  });

  it("applies partial overrides with defaults for remaining", () => {
    const config: MicroClawConfig = {
      memory: { embeddingModel: "text-embedding-3-small" },
    };
    const result = resolveMemoryBackendConfig(config, "/data");
    expect(result.embeddingModel).toBe("text-embedding-3-small");
    expect(result.vectorWeight).toBe(0.7);
    expect(result.keywordWeight).toBe(0.3);
    expect(result.maxResults).toBe(10);
  });

  it("preserves the provided dataDir", () => {
    const result = resolveMemoryBackendConfig({}, "/tmp/test");
    expect(result.dataDir).toBe("/tmp/test");
  });

  it("handles memory config with zero values", () => {
    const config: MicroClawConfig = {
      memory: { vectorWeight: 0, keywordWeight: 1, maxResults: 0 },
    };
    const result = resolveMemoryBackendConfig(config, "/data");
    // 0 is falsy but ?? only triggers on null/undefined
    expect(result.vectorWeight).toBe(0);
    expect(result.keywordWeight).toBe(1);
    expect(result.maxResults).toBe(0);
  });
});
