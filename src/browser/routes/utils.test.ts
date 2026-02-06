import { describe, it, expect, vi } from "vitest";
import {
  toStringOrEmpty,
  toNumber,
  toBoolean,
  toStringArray,
  jsonError,
  getProfileContext,
} from "./utils.js";
import type { BrowserRequest, BrowserResponse } from "./types.js";

// ---------------------------------------------------------------------------
// toStringOrEmpty
// ---------------------------------------------------------------------------

describe("toStringOrEmpty", () => {
  it("trims and returns string", () => {
    expect(toStringOrEmpty("  hello  ")).toBe("hello");
  });

  it("converts number to string", () => {
    expect(toStringOrEmpty(42)).toBe("42");
    expect(toStringOrEmpty(0)).toBe("0");
  });

  it("converts boolean to string", () => {
    expect(toStringOrEmpty(true)).toBe("true");
    expect(toStringOrEmpty(false)).toBe("false");
  });

  it("returns empty string for null", () => {
    expect(toStringOrEmpty(null)).toBe("");
  });

  it("returns empty string for object", () => {
    expect(toStringOrEmpty({ key: "value" })).toBe("");
  });

  it("returns empty string for array", () => {
    expect(toStringOrEmpty([1, 2])).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(toStringOrEmpty(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// toNumber
// ---------------------------------------------------------------------------

describe("toNumber", () => {
  it("returns finite number as-is", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-3.14)).toBe(-3.14);
  });

  it("parses numeric string", () => {
    expect(toNumber("42")).toBe(42);
    expect(toNumber("3.14")).toBe(3.14);
    expect(toNumber("-10")).toBe(-10);
  });

  it("returns undefined for non-numeric string", () => {
    expect(toNumber("abc")).toBeUndefined();
    expect(toNumber("")).toBeUndefined();
    expect(toNumber("  ")).toBeUndefined();
  });

  it("returns undefined for NaN", () => {
    expect(toNumber(NaN)).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(toNumber(Infinity)).toBeUndefined();
    expect(toNumber(-Infinity)).toBeUndefined();
  });

  it("returns undefined for non-number types", () => {
    expect(toNumber(null)).toBeUndefined();
    expect(toNumber(undefined)).toBeUndefined();
    expect(toNumber({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toBoolean
// ---------------------------------------------------------------------------

describe("toBoolean", () => {
  it("returns true for truthy strings", () => {
    expect(toBoolean("true")).toBe(true);
    expect(toBoolean("1")).toBe(true);
    expect(toBoolean("yes")).toBe(true);
  });

  it("returns false for falsy strings", () => {
    expect(toBoolean("false")).toBe(false);
    expect(toBoolean("0")).toBe(false);
    expect(toBoolean("no")).toBe(false);
  });

  it("returns undefined for unrecognized values", () => {
    expect(toBoolean("maybe")).toBeUndefined();
    expect(toBoolean("")).toBeUndefined();
    expect(toBoolean(42)).toBeUndefined();
    expect(toBoolean(null)).toBeUndefined();
  });

  it("handles boolean passthrough", () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toStringArray
// ---------------------------------------------------------------------------

describe("toStringArray", () => {
  it("returns string array from string values", () => {
    expect(toStringArray(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("coerces mixed types and filters empty", () => {
    expect(toStringArray([42, "hello", true, null])).toEqual(["42", "hello", "true"]);
  });

  it("returns undefined for empty array (after filtering)", () => {
    expect(toStringArray([])).toBeUndefined();
  });

  it("returns undefined for non-array input", () => {
    expect(toStringArray("not-array")).toBeUndefined();
    expect(toStringArray(42)).toBeUndefined();
    expect(toStringArray(null)).toBeUndefined();
    expect(toStringArray(undefined)).toBeUndefined();
  });

  it("filters out objects and arrays that produce empty strings", () => {
    expect(toStringArray([{}, [], "valid"])).toEqual(["valid"]);
  });
});

// ---------------------------------------------------------------------------
// jsonError
// ---------------------------------------------------------------------------

describe("jsonError", () => {
  it("sets status and sends JSON error", () => {
    const jsonFn = vi.fn();
    const statusFn = vi.fn(() => ({ json: jsonFn }));
    const res = { status: statusFn, json: jsonFn } as unknown as BrowserResponse;

    jsonError(res, 400, "Bad request");

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn).toHaveBeenCalledWith({ error: "Bad request" });
  });

  it("works with 404 status", () => {
    const jsonFn = vi.fn();
    const statusFn = vi.fn(() => ({ json: jsonFn }));
    const res = { status: statusFn, json: jsonFn } as unknown as BrowserResponse;

    jsonError(res, 404, "Not found");

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(jsonFn).toHaveBeenCalledWith({ error: "Not found" });
  });
});

// ---------------------------------------------------------------------------
// getProfileContext
// ---------------------------------------------------------------------------

describe("getProfileContext", () => {
  it("uses query.profile first", () => {
    const req: BrowserRequest = {
      params: {},
      query: { profile: "my-profile" },
      body: { profile: "body-profile" },
    };
    const mockCtx = {
      forProfile: vi.fn(() => ({ profileName: "my-profile" })),
    };

    const result = getProfileContext(req, mockCtx as never);
    expect(mockCtx.forProfile).toHaveBeenCalledWith("my-profile");
    expect(result).toEqual({ profileName: "my-profile" });
  });

  it("falls back to body.profile when query is missing", () => {
    const req: BrowserRequest = {
      params: {},
      query: {},
      body: { profile: "body-profile" },
    };
    const mockCtx = {
      forProfile: vi.fn(() => ({ profileName: "body-profile" })),
    };

    const result = getProfileContext(req, mockCtx as never);
    expect(mockCtx.forProfile).toHaveBeenCalledWith("body-profile");
    expect(result).toEqual({ profileName: "body-profile" });
  });

  it("passes undefined when no profile specified", () => {
    const req: BrowserRequest = {
      params: {},
      query: {},
    };
    const mockCtx = {
      forProfile: vi.fn(() => ({ profileName: "default" })),
    };

    const result = getProfileContext(req, mockCtx as never);
    expect(mockCtx.forProfile).toHaveBeenCalledWith(undefined);
    expect(result).toEqual({ profileName: "default" });
  });

  it("returns error object when forProfile throws", () => {
    const req: BrowserRequest = {
      params: {},
      query: { profile: "unknown" },
    };
    const mockCtx = {
      forProfile: vi.fn(() => {
        throw new Error("Profile not found: unknown");
      }),
    };

    const result = getProfileContext(req, mockCtx as never);
    expect(result).toEqual({
      error: "Error: Profile not found: unknown",
      status: 404,
    });
  });

  it("trims whitespace-only profile to undefined", () => {
    const req: BrowserRequest = {
      params: {},
      query: { profile: "   " },
    };
    const mockCtx = {
      forProfile: vi.fn(() => ({ profileName: "default" })),
    };

    getProfileContext(req, mockCtx as never);
    expect(mockCtx.forProfile).toHaveBeenCalledWith(undefined);
  });
});
