import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./keychain.js", () => ({
  readClaudeCodeCredentials: vi.fn(() => null),
}));

vi.mock("../logging.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn(actual.execFileSync),
    spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "", output: [] })),
  };
});

const { readClaudeCodeCredentials } = await import("./keychain.js");
const mockReadKeychain = vi.mocked(readClaudeCodeCredentials);

const { execFileSync, spawnSync } = await import("node:child_process");
const mockExecFileSync = vi.mocked(execFileSync);
const mockSpawnSync = vi.mocked(spawnSync);

// Dynamically import after mocks are registered
const { resolveAuthCredentials } = await import("./auth.js");

// ---------------------------------------------------------------------------
// env save/restore
// ---------------------------------------------------------------------------

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = savedEnv;
});

// ---------------------------------------------------------------------------
// resolveAuthCredentials
// ---------------------------------------------------------------------------

describe("resolveAuthCredentials", () => {
  it("returns apiKey when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test123";
    const creds = await resolveAuthCredentials();
    expect(creds.apiKey).toBe("sk-ant-test123");
    expect(creds.isOAuth).toBe(false);
  });

  it("returns authToken when ANTHROPIC_AUTH_TOKEN is set", async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "oauth-token-abc";
    const creds = await resolveAuthCredentials();
    expect(creds.authToken).toBe("oauth-token-abc");
    expect(creds.isOAuth).toBe(true);
  });

  it("returns keychain token when no env vars set", async () => {
    mockReadKeychain.mockReturnValue("keychain-token-xyz");
    const creds = await resolveAuthCredentials();
    expect(creds.authToken).toBe("keychain-token-xyz");
    expect(creds.isOAuth).toBe(true);
  });

  it("prioritizes API key over auth token", async () => {
    process.env.ANTHROPIC_API_KEY = "api-key";
    process.env.ANTHROPIC_AUTH_TOKEN = "auth-token";
    const creds = await resolveAuthCredentials();
    expect(creds.apiKey).toBe("api-key");
    expect(creds.isOAuth).toBe(false);
  });

  it("prioritizes auth token over keychain", async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "env-token";
    mockReadKeychain.mockReturnValue("keychain-token");
    const creds = await resolveAuthCredentials();
    expect(creds.authToken).toBe("env-token");
  });

  it("trims whitespace from API key", async () => {
    process.env.ANTHROPIC_API_KEY = "  sk-ant-test  ";
    const creds = await resolveAuthCredentials();
    expect(creds.apiKey).toBe("sk-ant-test");
  });

  it("trims whitespace from auth token", async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "  oauth-token  ";
    const creds = await resolveAuthCredentials();
    expect(creds.authToken).toBe("oauth-token");
  });

  it("does not attempt login when env vars are set (fast path)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-fast";
    await resolveAuthCredentials();
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Interactive login flow
  // ---------------------------------------------------------------------------

  describe("interactive login", () => {
    it("spawns claude setup-token when no creds and CLI available", async () => {
      mockReadKeychain.mockReturnValue(null);
      // `which claude` succeeds
      mockExecFileSync.mockReturnValue("" as never);
      // login succeeds, then keychain has token on retry
      mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", output: [], pid: 0, signal: null } as never);
      mockReadKeychain.mockReturnValueOnce(null).mockReturnValueOnce("new-token");

      const creds = await resolveAuthCredentials();

      expect(mockSpawnSync).toHaveBeenCalledWith(
        "claude",
        ["setup-token"],
        expect.objectContaining({ stdio: "inherit" }),
      );
      expect(creds.authToken).toBe("new-token");
      expect(creds.isOAuth).toBe(true);
    });

    it("returns credentials after successful login", async () => {
      // First call: no creds. After login: keychain has token.
      mockReadKeychain
        .mockReturnValueOnce(null)  // tryResolveCredentials (initial)
        .mockReturnValueOnce("post-login-token");  // tryResolveCredentials (retry)
      mockExecFileSync.mockReturnValue("" as never);
      mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", output: [], pid: 0, signal: null } as never);

      const creds = await resolveAuthCredentials();
      expect(creds.authToken).toBe("post-login-token");
    });

    it("throws when claude CLI is not installed", async () => {
      mockReadKeychain.mockReturnValue(null);
      mockExecFileSync.mockImplementation(() => {
        throw new Error("not found");
      });

      await expect(resolveAuthCredentials()).rejects.toThrow(
        "Claude CLI is not installed",
      );
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });

    it("throws when login succeeds but still no credentials", async () => {
      mockReadKeychain.mockReturnValue(null);
      mockExecFileSync.mockReturnValue("" as never);
      mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", output: [], pid: 0, signal: null } as never);

      await expect(resolveAuthCredentials()).rejects.toThrow(
        "No Anthropic credentials found after login attempt",
      );
    });

    it("still retries credentials when login exits non-zero", async () => {
      // User cancels (Ctrl+C) but we still check if keychain got populated
      mockReadKeychain
        .mockReturnValueOnce(null)
        .mockReturnValueOnce("token-despite-cancel");
      mockExecFileSync.mockReturnValue("" as never);
      mockSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "", output: [], pid: 0, signal: null } as never);

      const creds = await resolveAuthCredentials();
      expect(creds.authToken).toBe("token-despite-cancel");
    });
  });
});
