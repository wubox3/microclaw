import { describe, it, expect } from "vitest";
import { hashContent, chunkText, cosineSimilarity, truncateSnippet } from "./internal.js";

// ---------------------------------------------------------------------------
// hashContent
// ---------------------------------------------------------------------------

describe("hashContent", () => {
  it("returns deterministic output", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
  });

  it("returns different hashes for different content", () => {
    expect(hashContent("foo")).not.toBe(hashContent("bar"));
  });

  it("returns a 16-character hex string", () => {
    const hash = hashContent("test data");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("handles empty string", () => {
    const hash = hashContent("");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// chunkText
// ---------------------------------------------------------------------------

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    const result = chunkText("short text");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("short text");
  });

  it("splits long text into multiple chunks", () => {
    const longText = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join("\n");
    const result = chunkText(longText, 200, 50);
    expect(result.length).toBeGreaterThan(1);
  });

  it("preserves overlap between chunks", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line number ${i}`).join("\n");
    const result = chunkText(lines, 100, 30);
    if (result.length >= 2) {
      // The end of chunk 0 should overlap with the start of chunk 1
      const chunk0Lines = result[0]!.split("\n");
      const chunk1Lines = result[1]!.split("\n");
      const lastLinesOf0 = chunk0Lines.slice(-3);
      const firstLinesOf1 = chunk1Lines.slice(0, 3);
      // At least one overlapping line
      const hasOverlap = lastLinesOf0.some((line) => firstLinesOf1.includes(line));
      expect(hasOverlap).toBe(true);
    }
  });

  it("handles custom chunk sizes", () => {
    const text = Array.from({ length: 200 }, (_, i) => `x${i}`).join("\n");
    const smallChunks = chunkText(text, 50, 10);
    const largeChunks = chunkText(text, 500, 10);
    expect(smallChunks.length).toBeGreaterThan(largeChunks.length);
  });

  it("handles empty text", () => {
    const result = chunkText("");
    expect(result).toEqual([""]);
  });

  it("handles single line text", () => {
    const result = chunkText("single line");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("single line");
  });

  it("handles text with trailing newline", () => {
    const result = chunkText("line1\nline2\n");
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("line1");
    expect(result[0]).toContain("line2");
  });
});

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("returns 0 for different-length vectors", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for zero vector", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("handles single-element vectors", () => {
    expect(cosineSimilarity([5], [3])).toBeCloseTo(1);
  });

  it("handles negative values", () => {
    const sim = cosineSimilarity([-1, -2], [-1, -2]);
    expect(sim).toBeCloseTo(1);
  });
});

// ---------------------------------------------------------------------------
// truncateSnippet
// ---------------------------------------------------------------------------

describe("truncateSnippet", () => {
  it("returns original when under limit", () => {
    expect(truncateSnippet("short")).toBe("short");
  });

  it("truncates with ellipsis when over limit", () => {
    const long = "a".repeat(300);
    const result = truncateSnippet(long);
    expect(result.length).toBe(203); // 200 + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  it("respects custom maxLength", () => {
    const text = "hello world this is a test";
    const result = truncateSnippet(text, 10);
    expect(result).toBe("hello worl...");
  });

  it("returns exact text at boundary", () => {
    const exact = "a".repeat(200);
    expect(truncateSnippet(exact)).toBe(exact);
  });
});
