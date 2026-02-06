import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadConfig, resolveDataDir, resolvePort, resolveHost } from "./config.js";

// ---------------------------------------------------------------------------
// Mock node:fs
// ---------------------------------------------------------------------------

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
}));

const { existsSync, readFileSync } = await import("node:fs");
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// resolveDataDir
// ---------------------------------------------------------------------------

describe("resolveDataDir", () => {
  it("returns default when no config provided", () => {
    const result = resolveDataDir({});
    expect(result).toContain(".microclaw");
  });

  it("returns custom dataDir from config", () => {
    const result = resolveDataDir({ memory: { dataDir: "/custom/path" } });
    expect(result).toBe("/custom/path");
  });
});

// ---------------------------------------------------------------------------
// resolvePort
// ---------------------------------------------------------------------------

describe("resolvePort", () => {
  it("returns 3000 as default", () => {
    expect(resolvePort({})).toBe(3000);
  });

  it("returns custom port from config", () => {
    expect(resolvePort({ web: { port: 8080 } })).toBe(8080);
  });
});

// ---------------------------------------------------------------------------
// resolveHost
// ---------------------------------------------------------------------------

describe("resolveHost", () => {
  it("returns localhost as default", () => {
    expect(resolveHost({})).toBe("localhost");
  });

  it("returns custom host from config", () => {
    expect(resolveHost({ web: { host: "0.0.0.0" } })).toBe("0.0.0.0");
  });
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  it("returns empty config when no file exists", () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadConfig("/test")).toEqual({});
  });

  it("parses valid YAML config", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("microclaw.config.yaml"),
    );
    mockReadFileSync.mockReturnValue("web:\n  port: 4000\n");
    const config = loadConfig("/test");
    expect(config.web?.port).toBe(4000);
  });

  it("parses valid JSON config", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("microclaw.config.json"),
    );
    mockReadFileSync.mockReturnValue('{"web":{"port":5000}}');
    const config = loadConfig("/test");
    expect(config.web?.port).toBe(5000);
  });

  it("throws on invalid YAML", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("microclaw.config.yaml"),
    );
    mockReadFileSync.mockReturnValue("{ invalid:: yaml ::");
    expect(() => loadConfig("/test")).toThrow("Failed to parse");
  });

  it("throws on invalid JSON", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("microclaw.config.json"),
    );
    mockReadFileSync.mockReturnValue("{invalid json}");
    expect(() => loadConfig("/test")).toThrow("Failed to parse");
  });

  it("validates config is an object, not array", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("microclaw.config.json"),
    );
    mockReadFileSync.mockReturnValue("[1, 2, 3]");
    expect(() => loadConfig("/test")).toThrow("Config must be an object");
  });

  it("validates web must be an object", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("microclaw.config.json"),
    );
    mockReadFileSync.mockReturnValue('{"web":"invalid"}');
    expect(() => loadConfig("/test")).toThrow("'web' must be an object");
  });

  it("validates agent must be an object", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("microclaw.config.json"),
    );
    mockReadFileSync.mockReturnValue('{"agent":42}');
    expect(() => loadConfig("/test")).toThrow("'agent' must be an object");
  });

  it("validates memory must be an object", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("microclaw.config.json"),
    );
    mockReadFileSync.mockReturnValue('{"memory":true}');
    expect(() => loadConfig("/test")).toThrow("'memory' must be an object");
  });

  it("validates container must be an object", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("microclaw.config.json"),
    );
    mockReadFileSync.mockReturnValue('{"container":"nope"}');
    expect(() => loadConfig("/test")).toThrow("'container' must be an object");
  });

  it("validates web.port must be a number", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("microclaw.config.json"),
    );
    mockReadFileSync.mockReturnValue('{"web":{"port":"abc"}}');
    expect(() => loadConfig("/test")).toThrow("'web.port' must be a number");
  });

  it("validates agent.provider must be a string", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("microclaw.config.json"),
    );
    mockReadFileSync.mockReturnValue('{"agent":{"provider":123}}');
    expect(() => loadConfig("/test")).toThrow("'agent.provider' must be a string");
  });

  it("returns null/undefined values as empty config", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("microclaw.config.yaml"),
    );
    mockReadFileSync.mockReturnValue("---\n");
    const config = loadConfig("/test");
    expect(config).toEqual({});
  });

  it("checks YAML first, then YML, then JSON", () => {
    mockExistsSync.mockReturnValue(false);
    loadConfig("/test");
    const calls = mockExistsSync.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toContain("microclaw.config.yaml");
    expect(calls[1]).toContain("microclaw.config.yml");
    expect(calls[2]).toContain("microclaw.config.json");
  });

  it("throws on read error", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith("microclaw.config.yaml"),
    );
    mockReadFileSync.mockImplementation(() => {
      throw new Error("EACCES permission denied");
    });
    expect(() => loadConfig("/test")).toThrow("Failed to read");
  });
});
