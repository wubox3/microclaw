import { describe, it, expect, vi } from "vitest";
import { sleep, truncate, chunk, normalizeE164, hashString, uniqueBy, groupBy } from "./utils.js";

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe("truncate", () => {
  it("returns empty string when maxLength < 1", () => {
    expect(truncate("hello", 0)).toBe("");
    expect(truncate("hello", -5)).toBe("");
  });

  it("returns original when text is under limit", () => {
    expect(truncate("hi", 10)).toBe("hi");
    expect(truncate("abc", 3)).toBe("abc");
  });

  it("returns truncated text with ellipsis when over limit", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  it("returns raw slice when maxLength < 4", () => {
    expect(truncate("hello", 3)).toBe("hel");
    expect(truncate("hello", 1)).toBe("h");
    expect(truncate("hello", 2)).toBe("he");
  });

  it("handles exact boundary at maxLength = 4", () => {
    expect(truncate("hello", 4)).toBe("h...");
  });

  it("returns empty string for empty input with maxLength >= 1", () => {
    expect(truncate("", 5)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// chunk
// ---------------------------------------------------------------------------

describe("chunk", () => {
  it("returns empty array for empty input", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("splits array into exact multiples", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("handles remainder chunk", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("handles size = 1", () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it("returns single chunk when size > array length", () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("preserves element types", () => {
    expect(chunk(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
  });
});

// ---------------------------------------------------------------------------
// normalizeE164
// ---------------------------------------------------------------------------

describe("normalizeE164", () => {
  it("prepends + when digits only", () => {
    expect(normalizeE164("14155551234")).toBe("+14155551234");
  });

  it("keeps existing + prefix", () => {
    expect(normalizeE164("+14155551234")).toBe("+14155551234");
  });

  it("strips non-digit characters except leading +", () => {
    expect(normalizeE164("+1 (415) 555-1234")).toBe("+14155551234");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeE164("")).toBe("");
  });

  it("returns empty string for non-digit input", () => {
    expect(normalizeE164("abc")).toBe("");
  });

  it("handles number with dashes only", () => {
    expect(normalizeE164("1-415-555-1234")).toBe("+14155551234");
  });
});

// ---------------------------------------------------------------------------
// hashString
// ---------------------------------------------------------------------------

describe("hashString", () => {
  it("produces deterministic output", () => {
    expect(hashString("test")).toBe(hashString("test"));
  });

  it("produces different hashes for different strings", () => {
    expect(hashString("foo")).not.toBe(hashString("bar"));
  });

  it("handles empty string", () => {
    expect(hashString("")).toBe(0);
  });

  it("returns a non-negative number", () => {
    expect(hashString("negative-test")).toBeGreaterThanOrEqual(0);
    expect(hashString("another")).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// uniqueBy
// ---------------------------------------------------------------------------

describe("uniqueBy", () => {
  it("removes duplicates by key", () => {
    const items = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
      { id: "1", name: "AliceDup" },
    ];
    const result = uniqueBy(items, (x) => x.id);
    expect(result).toEqual([
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ]);
  });

  it("keeps first occurrence", () => {
    const items = [
      { k: "a", v: 1 },
      { k: "a", v: 2 },
    ];
    expect(uniqueBy(items, (x) => x.k)).toEqual([{ k: "a", v: 1 }]);
  });

  it("handles empty array", () => {
    expect(uniqueBy([], (x) => String(x))).toEqual([]);
  });

  it("returns all items when no duplicates", () => {
    const items = [{ id: "1" }, { id: "2" }, { id: "3" }];
    expect(uniqueBy(items, (x) => x.id)).toEqual(items);
  });
});

// ---------------------------------------------------------------------------
// groupBy
// ---------------------------------------------------------------------------

describe("groupBy", () => {
  it("groups items by key", () => {
    const items = [
      { type: "a", val: 1 },
      { type: "b", val: 2 },
      { type: "a", val: 3 },
    ];
    const result = groupBy(items, (x) => x.type);
    expect(result).toEqual({
      a: [
        { type: "a", val: 1 },
        { type: "a", val: 3 },
      ],
      b: [{ type: "b", val: 2 }],
    });
  });

  it("returns single group when all same key", () => {
    const items = [{ k: "x" }, { k: "x" }];
    expect(groupBy(items, (x) => x.k)).toEqual({ x: [{ k: "x" }, { k: "x" }] });
  });

  it("returns empty object for empty array", () => {
    expect(groupBy([], () => "k")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// sleep
// ---------------------------------------------------------------------------

describe("sleep", () => {
  it("resolves after the given delay", async () => {
    vi.useFakeTimers();
    const p = sleep(100);
    vi.advanceTimersByTime(100);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("does not resolve before the delay", async () => {
    vi.useFakeTimers();
    let resolved = false;
    sleep(200).then(() => { resolved = true; });
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    expect(resolved).toBe(false);
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});
