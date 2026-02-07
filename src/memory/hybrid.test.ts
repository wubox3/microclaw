import { describe, it, expect } from "vitest";
import { mergeSearchResults, buildFtsQuery } from "./hybrid.js";
import type { VectorSearchResult, KeywordSearchResult } from "./hybrid.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVectorResult(overrides: Partial<VectorSearchResult> = {}): VectorSearchResult {
  return {
    chunkId: 1,
    fileId: 1,
    filePath: "test.ts",
    source: "file",
    content: "test content",
    snippet: "test snippet",
    startLine: 1,
    endLine: 10,
    score: 0.9,
    ...overrides,
  };
}

function makeKeywordResult(overrides: Partial<KeywordSearchResult> = {}): KeywordSearchResult {
  return {
    chunkId: 2,
    fileId: 2,
    filePath: "test2.ts",
    source: "file",
    content: "keyword content",
    snippet: "keyword snippet",
    startLine: 5,
    endLine: 15,
    bm25Score: 5.0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mergeSearchResults
// ---------------------------------------------------------------------------

describe("mergeSearchResults", () => {
  it("returns vector-only results", () => {
    const results = mergeSearchResults({
      vectorResults: [makeVectorResult({ chunkId: 1, score: 0.8 })],
      keywordResults: [],
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      limit: 10,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.vectorScore).toBe(0.8);
    expect(results[0]!.textScore).toBe(0);
    expect(results[0]!.combinedScore).toBeCloseTo(0.56);
  });

  it("returns keyword-only results", () => {
    const results = mergeSearchResults({
      vectorResults: [],
      keywordResults: [makeKeywordResult({ chunkId: 1, bm25Score: 10 })],
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      limit: 10,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.vectorScore).toBe(0);
    expect(results[0]!.textScore).toBeCloseTo(1);
    expect(results[0]!.combinedScore).toBeCloseTo(0.3);
  });

  it("merges overlapping results by chunkId", () => {
    const results = mergeSearchResults({
      vectorResults: [makeVectorResult({ chunkId: 5, score: 0.9 })],
      keywordResults: [makeKeywordResult({ chunkId: 5, bm25Score: 8 })],
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      limit: 10,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.vectorScore).toBe(0.9);
    expect(results[0]!.textScore).toBeCloseTo(1); // 8/8 = 1 (max is 8)
    expect(results[0]!.combinedScore).toBeCloseTo(0.9 * 0.7 + 1 * 0.3);
  });

  it("normalizes BM25 scores to 0-1", () => {
    const results = mergeSearchResults({
      vectorResults: [],
      keywordResults: [
        makeKeywordResult({ chunkId: 1, bm25Score: 10 }),
        makeKeywordResult({ chunkId: 2, bm25Score: 5 }),
      ],
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      limit: 10,
    });
    expect(results[0]!.textScore).toBeCloseTo(1);
    expect(results[1]!.textScore).toBeCloseTo(0.5);
  });

  it("sorts by combined score descending", () => {
    const results = mergeSearchResults({
      vectorResults: [
        makeVectorResult({ chunkId: 1, score: 0.5 }),
        makeVectorResult({ chunkId: 2, score: 0.9 }),
      ],
      keywordResults: [],
      vectorWeight: 1,
      keywordWeight: 0,
      limit: 10,
    });
    expect(results[0]!.chunkId).toBe(2);
    expect(results[1]!.chunkId).toBe(1);
  });

  it("respects limit parameter", () => {
    const vectorResults = Array.from({ length: 10 }, (_, i) =>
      makeVectorResult({ chunkId: i, score: 0.9 - i * 0.05 }),
    );
    const results = mergeSearchResults({
      vectorResults,
      keywordResults: [],
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      limit: 3,
    });
    expect(results).toHaveLength(3);
  });

  it("handles empty inputs", () => {
    const results = mergeSearchResults({
      vectorResults: [],
      keywordResults: [],
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      limit: 10,
    });
    expect(results).toEqual([]);
  });

  it("preserves snippet from vector result in overlap", () => {
    const results = mergeSearchResults({
      vectorResults: [makeVectorResult({ chunkId: 5, snippet: "vector snippet" })],
      keywordResults: [makeKeywordResult({ chunkId: 5, snippet: "keyword snippet" })],
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      limit: 10,
    });
    expect(results[0]!.snippet).toBe("vector snippet");
  });
});

// ---------------------------------------------------------------------------
// buildFtsQuery
// ---------------------------------------------------------------------------

describe("buildFtsQuery", () => {
  it("wraps single word in quotes", () => {
    expect(buildFtsQuery("hello")).toBe('"hello"');
  });

  it("joins multiple words with AND", () => {
    expect(buildFtsQuery("hello world")).toBe('"hello" AND "world"');
  });

  it("strips special characters", () => {
    expect(buildFtsQuery("hello! world?")).toBe('"hello" AND "world"');
  });

  it("filters single-character tokens", () => {
    expect(buildFtsQuery("I am a developer")).toBe('"am" AND "developer"');
  });

  it("returns empty string for all-special input", () => {
    expect(buildFtsQuery("!@#$%")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(buildFtsQuery("")).toBe("");
  });

  it("handles mixed alphanumeric and special", () => {
    expect(buildFtsQuery("foo.bar(baz)")).toBe('"foo" AND "bar" AND "baz"');
  });

  it("falls back to joined single-char tokens", () => {
    // Single-char tokens are joined into a single token for FTS
    expect(buildFtsQuery("a b c")).toBe('"abc"');
  });
});
