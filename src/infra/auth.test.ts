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

const { readClaudeCodeCredentials } = await import("./keychain.js");
const mockReadKeychain = vi.mocked(readClaudeCodeCredentials);

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
  it("returns apiKey when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test123";
    const creds = resolveAuthCredentials();
    expect(creds.apiKey).toBe("sk-ant-test123");
    expect(creds.isOAuth).toBe(false);
  });

  it("returns authToken when ANTHROPIC_AUTH_TOKEN is set", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "oauth-token-abc";
    const creds = resolveAuthCredentials();
    expect(creds.authToken).toBe("oauth-token-abc");
    expect(creds.isOAuth).toBe(true);
  });

  it("returns keychain token when no env vars set", () => {
    mockReadKeychain.mockReturnValue("keychain-token-xyz");
    const creds = resolveAuthCredentials();
    expect(creds.authToken).toBe("keychain-token-xyz");
    expect(creds.isOAuth).toBe(true);
  });

  it("throws when no credentials found", () => {
    mockReadKeychain.mockReturnValue(null);
    expect(() => resolveAuthCredentials()).toThrow("No Anthropic credentials found");
  });

  it("prioritizes API key over auth token", () => {
    process.env.ANTHROPIC_API_KEY = "api-key";
    process.env.ANTHROPIC_AUTH_TOKEN = "auth-token";
    const creds = resolveAuthCredentials();
    expect(creds.apiKey).toBe("api-key");
    expect(creds.isOAuth).toBe(false);
  });

  it("prioritizes auth token over keychain", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "env-token";
    mockReadKeychain.mockReturnValue("keychain-token");
    const creds = resolveAuthCredentials();
    expect(creds.authToken).toBe("env-token");
  });

  it("trims whitespace from API key", () => {
    process.env.ANTHROPIC_API_KEY = "  sk-ant-test  ";
    const creds = resolveAuthCredentials();
    expect(creds.apiKey).toBe("sk-ant-test");
  });

  it("trims whitespace from auth token", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "  oauth-token  ";
    const creds = resolveAuthCredentials();
    expect(creds.authToken).toBe("oauth-token");
  });
});
