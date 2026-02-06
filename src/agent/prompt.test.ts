import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./prompt.js";
import type { MemorySearchResult } from "../memory/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemoryResult(overrides: Partial<MemorySearchResult> = {}): MemorySearchResult {
  return {
    chunkId: 1,
    fileId: 1,
    filePath: "src/utils.ts",
    source: "file",
    content: "function helper() {}",
    snippet: "helper function for utils",
    startLine: 10,
    endLine: 20,
    vectorScore: 0.9,
    textScore: 0.5,
    combinedScore: 0.7,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSystemPrompt", () => {
  it("includes default system prompt when no custom prompt", () => {
    const prompt = buildSystemPrompt({ config: {} });
    expect(prompt).toContain("MicroClaw");
    expect(prompt).toContain("helpful AI assistant");
  });

  it("uses custom system prompt from config", () => {
    const prompt = buildSystemPrompt({
      config: { agent: { systemPrompt: "You are a custom bot." } },
    });
    expect(prompt).toContain("You are a custom bot.");
    expect(prompt).not.toContain("helpful AI assistant");
  });

  it("includes canvas instructions when canvasEnabled", () => {
    const prompt = buildSystemPrompt({ config: {}, canvasEnabled: true });
    expect(prompt).toContain("canvas tool");
    expect(prompt).toContain("a2ui_push");
  });

  it("excludes canvas instructions when not enabled", () => {
    const prompt = buildSystemPrompt({ config: {}, canvasEnabled: false });
    expect(prompt).not.toContain("canvas tool");
  });

  it("includes channel id when provided", () => {
    const prompt = buildSystemPrompt({ config: {}, channelId: "telegram" });
    expect(prompt).toContain("Current channel: telegram");
  });

  it("excludes channel section when no channelId", () => {
    const prompt = buildSystemPrompt({ config: {} });
    expect(prompt).not.toContain("Current channel:");
  });

  it("includes memory results with file paths", () => {
    const results = [
      makeMemoryResult({ filePath: "src/auth.ts", startLine: 5, snippet: "auth logic" }),
    ];
    const prompt = buildSystemPrompt({ config: {}, memoryResults: results });
    expect(prompt).toContain("[src/auth.ts:5]");
    expect(prompt).toContain("auth logic");
    expect(prompt).toContain("Relevant Memory Context");
  });

  it("limits memory results to 5", () => {
    const results = Array.from({ length: 8 }, (_, i) =>
      makeMemoryResult({ chunkId: i, filePath: `file${i}.ts`, snippet: `snippet ${i}` }),
    );
    const prompt = buildSystemPrompt({ config: {}, memoryResults: results });
    expect(prompt).toContain("snippet 4");
    expect(prompt).not.toContain("snippet 5");
  });

  it("excludes memory section when results are empty", () => {
    const prompt = buildSystemPrompt({ config: {}, memoryResults: [] });
    expect(prompt).not.toContain("Relevant Memory Context");
  });

  it("excludes memory section when results are undefined", () => {
    const prompt = buildSystemPrompt({ config: {} });
    expect(prompt).not.toContain("Relevant Memory Context");
  });
});
