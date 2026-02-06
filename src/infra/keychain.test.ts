import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  platform: vi.fn(() => "darwin"),
}));

vi.mock("../logging.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

const { execFileSync } = await import("node:child_process");
const { platform } = await import("node:os");
const mockExecFileSync = vi.mocked(execFileSync);
const mockPlatform = vi.mocked(platform);

// Dynamically import after mocks
const { readClaudeCodeCredentials } = await import("./keychain.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockPlatform.mockReturnValue("darwin");
});

// ---------------------------------------------------------------------------
// readClaudeCodeCredentials
// ---------------------------------------------------------------------------

describe("readClaudeCodeCredentials", () => {
  it("returns null on non-darwin platform", () => {
    mockPlatform.mockReturnValue("linux");
    expect(readClaudeCodeCredentials()).toBeNull();
  });

  it("returns access token from valid keychain entry", () => {
    const entry = JSON.stringify({
      claudeAiOauth: { accessToken: "my-token" },
    });
    mockExecFileSync.mockReturnValue(entry);
    expect(readClaudeCodeCredentials()).toBe("my-token");
  });

  it("returns null for expired token", () => {
    const entry = JSON.stringify({
      claudeAiOauth: {
        accessToken: "expired-token",
        expiresAt: Date.now() - 60_000, // expired 1 minute ago (milliseconds)
      },
    });
    mockExecFileSync.mockReturnValue(entry);
    expect(readClaudeCodeCredentials()).toBeNull();
  });

  it("converts seconds-based expiresAt to milliseconds", () => {
    // A timestamp in seconds (well below 1e12)
    const futureSeconds = Math.floor(Date.now() / 1000) + 3600;
    const entry = JSON.stringify({
      claudeAiOauth: {
        accessToken: "valid-token",
        expiresAt: futureSeconds,
      },
    });
    mockExecFileSync.mockReturnValue(entry);
    expect(readClaudeCodeCredentials()).toBe("valid-token");
  });

  it("returns null when accessToken is missing", () => {
    const entry = JSON.stringify({ claudeAiOauth: {} });
    mockExecFileSync.mockReturnValue(entry);
    expect(readClaudeCodeCredentials()).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    mockExecFileSync.mockReturnValue("not-json{{{");
    expect(readClaudeCodeCredentials()).toBeNull();
  });

  it("returns null when exec throws", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("security: SecKeychainSearchCopyNext: The specified item could not be found.");
    });
    expect(readClaudeCodeCredentials()).toBeNull();
  });

  it("returns null when claudeAiOauth is undefined", () => {
    const entry = JSON.stringify({ otherField: "value" });
    mockExecFileSync.mockReturnValue(entry);
    expect(readClaudeCodeCredentials()).toBeNull();
  });

  it("returns token when expiresAt is not set", () => {
    const entry = JSON.stringify({
      claudeAiOauth: { accessToken: "no-expiry-token" },
    });
    mockExecFileSync.mockReturnValue(entry);
    expect(readClaudeCodeCredentials()).toBe("no-expiry-token");
  });

  it("returns token when expiresAt is in the future (ms)", () => {
    const entry = JSON.stringify({
      claudeAiOauth: {
        accessToken: "future-token",
        expiresAt: Date.now() + 3_600_000, // 1 hour from now in ms
      },
    });
    mockExecFileSync.mockReturnValue(entry);
    expect(readClaudeCodeCredentials()).toBe("future-token");
  });
});
