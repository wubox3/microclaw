import { describe, it, expect } from "vitest";
import { createLogger, logger } from "./logging.js";

// ---------------------------------------------------------------------------
// createLogger
// ---------------------------------------------------------------------------

describe("createLogger", () => {
  it("creates logger with the given name", () => {
    const log = createLogger("test-module");
    expect(log.settings.name).toBe("test-module");
  });

  it("uses default minLevel of 3 (info)", () => {
    const log = createLogger("default-level");
    expect(log.settings.minLevel).toBe(3);
  });

  it("maps custom minLevel correctly", () => {
    const debugLog = createLogger("debug-module", "debug");
    expect(debugLog.settings.minLevel).toBe(2);

    const errorLog = createLogger("error-module", "error");
    expect(errorLog.settings.minLevel).toBe(5);

    const sillyLog = createLogger("silly-module", "silly");
    expect(sillyLog.settings.minLevel).toBe(0);
  });

  it("maps all log levels", () => {
    const levels = {
      silly: 0,
      trace: 1,
      debug: 2,
      info: 3,
      warn: 4,
      error: 5,
      fatal: 6,
    } as const;

    for (const [level, expected] of Object.entries(levels)) {
      const log = createLogger("test", level as keyof typeof levels);
      expect(log.settings.minLevel).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// logger (singleton)
// ---------------------------------------------------------------------------

describe("logger", () => {
  it("is a Logger instance with name microclaw", () => {
    expect(logger.settings.name).toBe("microclaw");
  });

  it("has default minLevel 3", () => {
    expect(logger.settings.minLevel).toBe(3);
  });
});
