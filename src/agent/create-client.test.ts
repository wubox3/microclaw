import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLlmClient } from "./create-client.js";
import type { EClawConfig } from "../config/types.js";
import type { AuthCredentials } from "../infra/auth.js";

// ---------------------------------------------------------------------------
// Mock the client constructors
// ---------------------------------------------------------------------------

const mockAnthropicClient = {
  sendMessage: vi.fn(),
  streamMessage: vi.fn(),
};

const mockOpenRouterClient = {
  sendMessage: vi.fn(),
  streamMessage: vi.fn(),
};

vi.mock("./client.js", () => ({
  createAnthropicClient: vi.fn(() => mockAnthropicClient),
}));

vi.mock("./openrouter-client.js", () => ({
  createOpenRouterClient: vi.fn(() => mockOpenRouterClient),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultAuth: AuthCredentials = {
  apiKey: "sk-ant-test",
  isOAuth: false,
};

function makeConfig(
  agentOverrides: EClawConfig["agent"] = {},
): EClawConfig {
  return { agent: agentOverrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createLlmClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("provider selection", () => {
    it("defaults to anthropic when provider is not set", async () => {
      const { createAnthropicClient } = await import("./client.js");
      const client = createLlmClient({
        config: makeConfig(),
        auth: defaultAuth,
      });

      expect(createAnthropicClient).toHaveBeenCalledWith({
        auth: defaultAuth,
        model: undefined,
        maxTokens: undefined,
      });
      expect(client).toBe(mockAnthropicClient);
    });

    it("creates anthropic client when provider is explicitly 'anthropic'", async () => {
      const { createAnthropicClient } = await import("./client.js");
      const client = createLlmClient({
        config: makeConfig({ provider: "anthropic" }),
        auth: defaultAuth,
      });

      expect(createAnthropicClient).toHaveBeenCalled();
      expect(client).toBe(mockAnthropicClient);
    });

    it("creates openrouter client when provider is 'openrouter'", async () => {
      process.env.OPENROUTER_API_KEY = "sk-or-test-key";
      const { createOpenRouterClient } = await import(
        "./openrouter-client.js"
      );

      const client = createLlmClient({
        config: makeConfig({ provider: "openrouter" }),
        auth: defaultAuth,
      });

      expect(createOpenRouterClient).toHaveBeenCalledWith({
        apiKey: "sk-or-test-key",
        model: undefined,
        maxTokens: undefined,
      });
      expect(client).toBe(mockOpenRouterClient);
    });

    it("throws for unsupported provider", () => {
      const config = makeConfig();
      // Force an unsupported provider via type assertion
      config.agent!.provider = "openai" as "anthropic";

      expect(() =>
        createLlmClient({ config, auth: defaultAuth }),
      ).toThrow('Unsupported LLM provider: "openai". Supported: "anthropic", "openrouter".');
    });
  });

  describe("config forwarding", () => {
    it("passes model and maxTokens to anthropic client", async () => {
      const { createAnthropicClient } = await import("./client.js");

      createLlmClient({
        config: makeConfig({
          provider: "anthropic",
          model: "claude-opus-4-6",
          maxTokens: 8192,
        }),
        auth: defaultAuth,
      });

      expect(createAnthropicClient).toHaveBeenCalledWith({
        auth: defaultAuth,
        model: "claude-opus-4-6",
        maxTokens: 8192,
      });
    });

    it("passes model and maxTokens to openrouter client", async () => {
      process.env.OPENROUTER_API_KEY = "sk-or-test-key";
      const { createOpenRouterClient } = await import(
        "./openrouter-client.js"
      );

      createLlmClient({
        config: makeConfig({
          provider: "openrouter",
          model: "openai/gpt-4o",
          maxTokens: 2048,
        }),
        auth: defaultAuth,
      });

      expect(createOpenRouterClient).toHaveBeenCalledWith({
        apiKey: "sk-or-test-key",
        model: "openai/gpt-4o",
        maxTokens: 2048,
      });
    });
  });

  describe("environment variable handling", () => {
    it("throws when OPENROUTER_API_KEY is missing for openrouter provider", () => {
      delete process.env.OPENROUTER_API_KEY;

      expect(() =>
        createLlmClient({
          config: makeConfig({ provider: "openrouter" }),
          auth: defaultAuth,
        }),
      ).toThrow("Missing required environment variable: OPENROUTER_API_KEY");
    });

    it("does not require OPENROUTER_API_KEY for anthropic provider", () => {
      delete process.env.OPENROUTER_API_KEY;

      expect(() =>
        createLlmClient({
          config: makeConfig({ provider: "anthropic" }),
          auth: defaultAuth,
        }),
      ).not.toThrow();
    });
  });

  describe("config edge cases", () => {
    it("handles empty config (no agent section)", async () => {
      const { createAnthropicClient } = await import("./client.js");

      createLlmClient({
        config: {},
        auth: defaultAuth,
      });

      expect(createAnthropicClient).toHaveBeenCalledWith({
        auth: defaultAuth,
        model: undefined,
        maxTokens: undefined,
      });
    });
  });
});
