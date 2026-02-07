import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requireEnv, optionalEnv, isDev } from "./env.js";

// ---------------------------------------------------------------------------
// env save/restore
// ---------------------------------------------------------------------------

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
});

afterEach(() => {
  process.env = savedEnv;
});

// ---------------------------------------------------------------------------
// requireEnv
// ---------------------------------------------------------------------------

describe("requireEnv", () => {
  it("returns value when present", () => {
    process.env.TEST_REQUIRE_VAR = "hello";
    expect(requireEnv("TEST_REQUIRE_VAR")).toBe("hello");
  });

  it("throws when missing", () => {
    delete process.env.TEST_MISSING_VAR;
    expect(() => requireEnv("TEST_MISSING_VAR")).toThrow("Missing required environment variable");
  });

  it("throws when empty string", () => {
    process.env.TEST_EMPTY_VAR = "";
    expect(() => requireEnv("TEST_EMPTY_VAR")).toThrow("Missing required");
  });
});

// ---------------------------------------------------------------------------
// optionalEnv
// ---------------------------------------------------------------------------

describe("optionalEnv", () => {
  it("returns value when present", () => {
    process.env.TEST_OPT_VAR = "world";
    expect(optionalEnv("TEST_OPT_VAR")).toBe("world");
  });

  it("returns undefined when missing and no fallback", () => {
    delete process.env.TEST_OPT_MISSING;
    expect(optionalEnv("TEST_OPT_MISSING")).toBeUndefined();
  });

  it("returns fallback when missing", () => {
    delete process.env.TEST_OPT_FB;
    expect(optionalEnv("TEST_OPT_FB", "default")).toBe("default");
  });

  it("returns env value over fallback when present", () => {
    process.env.TEST_OPT_PRIO = "env-value";
    expect(optionalEnv("TEST_OPT_PRIO", "fallback")).toBe("env-value");
  });
});

// ---------------------------------------------------------------------------
// isDev
// ---------------------------------------------------------------------------

describe("isDev", () => {
  it("returns false when NODE_ENV is production", () => {
    process.env.NODE_ENV = "production";
    expect(isDev()).toBe(false);
  });

  it("returns true when NODE_ENV is development", () => {
    process.env.NODE_ENV = "development";
    expect(isDev()).toBe(true);
  });

  it("returns false when NODE_ENV is unset", () => {
    delete process.env.NODE_ENV;
    expect(isDev()).toBe(false);
  });

  it("returns false for unknown NODE_ENV values", () => {
    process.env.NODE_ENV = "staging";
    expect(isDev()).toBe(false);
  });
});
