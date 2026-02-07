import { describe, it, expect } from "vitest";
import { AppError, ConfigError, ChannelError, MemoryError, formatError } from "./errors.js";

// ---------------------------------------------------------------------------
// AppError
// ---------------------------------------------------------------------------

describe("AppError", () => {
  it("sets correct name", () => {
    const err = new AppError("test", "TEST_ERROR");
    expect(err.name).toBe("AppError");
  });

  it("sets message, code, and default statusCode", () => {
    const err = new AppError("something failed", "FAIL_CODE");
    expect(err.message).toBe("something failed");
    expect(err.code).toBe("FAIL_CODE");
    expect(err.statusCode).toBe(500);
  });

  it("accepts custom statusCode", () => {
    const err = new AppError("not found", "NOT_FOUND", 404);
    expect(err.statusCode).toBe(404);
  });

  it("is instanceof Error", () => {
    const err = new AppError("test", "TEST");
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// ConfigError
// ---------------------------------------------------------------------------

describe("ConfigError", () => {
  it("sets correct name and code", () => {
    const err = new ConfigError("bad config");
    expect(err.name).toBe("ConfigError");
    expect(err.code).toBe("CONFIG_ERROR");
    expect(err.statusCode).toBe(500);
  });

  it("preserves message", () => {
    const err = new ConfigError("missing field");
    expect(err.message).toBe("missing field");
  });

  it("is instanceof AppError", () => {
    expect(new ConfigError("test")).toBeInstanceOf(AppError);
  });
});

// ---------------------------------------------------------------------------
// ChannelError
// ---------------------------------------------------------------------------

describe("ChannelError", () => {
  it("prefixes message with channel id", () => {
    const err = new ChannelError("connection failed", "telegram");
    expect(err.message).toBe("[telegram] connection failed");
  });

  it("sets correct name and code", () => {
    const err = new ChannelError("test", "slack");
    expect(err.name).toBe("ChannelError");
    expect(err.code).toBe("CHANNEL_ERROR");
  });

  it("is instanceof AppError", () => {
    expect(new ChannelError("test", "discord")).toBeInstanceOf(AppError);
  });
});

// ---------------------------------------------------------------------------
// MemoryError
// ---------------------------------------------------------------------------

describe("MemoryError", () => {
  it("sets correct name and code", () => {
    const err = new MemoryError("db failure");
    expect(err.name).toBe("MemoryError");
    expect(err.code).toBe("MEMORY_ERROR");
    expect(err.statusCode).toBe(500);
  });

  it("preserves message", () => {
    const err = new MemoryError("index corrupted");
    expect(err.message).toBe("index corrupted");
  });

  it("is instanceof AppError", () => {
    expect(new MemoryError("test")).toBeInstanceOf(AppError);
  });
});

// ---------------------------------------------------------------------------
// formatError
// ---------------------------------------------------------------------------

describe("formatError", () => {
  it("returns stack trace for Error instances", () => {
    const result = formatError(new Error("oops"));
    expect(result).toContain("oops");
    expect(result).toContain("Error:");
  });

  it("converts string to string", () => {
    expect(formatError("plain string")).toBe("plain string");
  });

  it("converts number to string", () => {
    expect(formatError(42)).toBe("42");
  });

  it("converts null to string", () => {
    expect(formatError(null)).toBe("null");
  });

  it("converts undefined to string", () => {
    expect(formatError(undefined)).toBe("undefined");
  });
});
