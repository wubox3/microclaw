import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { textToSpeech, resolveTtsConfig } from "./tts.js";
import type { MicroClawConfig } from "../config/types.js";

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: MicroClawConfig["voice"]): MicroClawConfig {
  // Default to enabled for tests that exercise TTS behavior
  const defaults: MicroClawConfig["voice"] = { tts: { enabled: true } };
  if (overrides?.tts) {
    return { voice: { ...defaults, tts: { ...defaults.tts, ...overrides.tts } } };
  }
  return { voice: overrides ?? defaults };
}

function mockSuccessResponse(audioData: Uint8Array = new Uint8Array([1, 2, 3])) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    arrayBuffer: () => Promise.resolve(audioData.buffer),
  });
}

function mockErrorResponse(status: number, body = "error") {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// resolveTtsConfig
// ---------------------------------------------------------------------------

describe("resolveTtsConfig", () => {
  it("returns defaults when no config provided", () => {
    const resolved = resolveTtsConfig({});
    expect(resolved.enabled).toBe(true);
    expect(resolved.provider).toBe("openrouter");
    expect(resolved.model).toBe("openai/tts-1");
    expect(resolved.voice).toBe("alloy");
    expect(resolved.maxTextLength).toBe(4096);
    expect(resolved.timeoutMs).toBe(30_000);
  });

  it("applies config overrides", () => {
    const config = makeConfig({
      tts: {
        enabled: true,
        provider: "openai",
        voice: "nova",
        model: "tts-1",
        maxTextLength: 2000,
        timeoutMs: 10_000,
      },
    });
    const resolved = resolveTtsConfig(config);
    expect(resolved.enabled).toBe(true);
    expect(resolved.provider).toBe("openai");
    expect(resolved.voice).toBe("nova");
    expect(resolved.model).toBe("tts-1");
    expect(resolved.maxTextLength).toBe(2000);
    expect(resolved.timeoutMs).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// textToSpeech
// ---------------------------------------------------------------------------

describe("textToSpeech", () => {
  it("returns error when no API key is configured", async () => {
    const originalKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    try {
      const result = await textToSpeech({
        text: "Hello world",
        config: makeConfig(),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("No API key configured for TTS");
    } finally {
      if (originalKey) process.env.OPENROUTER_API_KEY = originalKey;
    }
  });

  it("returns error when text exceeds max length", async () => {
    const longText = "a".repeat(5000);
    const result = await textToSpeech({
      text: longText,
      config: makeConfig({ tts: { maxTextLength: 100 } }),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("too long");
  });

  it("returns audio buffer on successful TTS call", async () => {
    const originalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";

    try {
      const audioBytes = new Uint8Array([72, 101, 108, 108, 111]);
      mockSuccessResponse(audioBytes);

      const result = await textToSpeech({
        text: "Hello",
        config: makeConfig(),
      });

      expect(result.success).toBe(true);
      expect(result.audioBuffer).toBeDefined();
      expect(result.audioBuffer!.length).toBe(5);
      expect(result.contentType).toBe("audio/mpeg");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      if (originalKey) {
        process.env.OPENROUTER_API_KEY = originalKey;
      } else {
        delete process.env.OPENROUTER_API_KEY;
      }
    }
  });

  it("sends correct request parameters via OpenRouter", async () => {
    const originalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";

    try {
      mockSuccessResponse();

      await textToSpeech({
        text: "Test message",
        config: makeConfig({ tts: { voice: "echo", model: "openai/tts-1-hd" } }),
        voice: "nova",
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://openrouter.ai/api/v1/audio/speech");
      const body = JSON.parse(opts.body);
      expect(body.input).toBe("Test message");
      expect(body.voice).toBe("nova"); // voice param overrides config
      expect(body.model).toBe("openai/tts-1-hd");
      expect(body.response_format).toBe("mp3");
      // OpenRouter-specific headers
      expect(opts.headers["HTTP-Referer"]).toBe("https://github.com/wubox3/microclaw");
      expect(opts.headers["X-Title"]).toBe("MicroClaw");
    } finally {
      if (originalKey) {
        process.env.OPENROUTER_API_KEY = originalKey;
      } else {
        delete process.env.OPENROUTER_API_KEY;
      }
    }
  });

  it("sends to OpenAI when provider is openai", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-key";

    try {
      mockSuccessResponse();

      await textToSpeech({
        text: "Hello",
        config: makeConfig({ tts: { provider: "openai", model: "tts-1" } }),
      });

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://api.openai.com/v1/audio/speech");
      expect(opts.headers["HTTP-Referer"]).toBeUndefined();
    } finally {
      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
    }
  });

  it("returns error on API failure", async () => {
    const originalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";

    try {
      mockErrorResponse(500, "Internal server error");

      const result = await textToSpeech({
        text: "Hello",
        config: makeConfig(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("500");
    } finally {
      if (originalKey) {
        process.env.OPENROUTER_API_KEY = originalKey;
      } else {
        delete process.env.OPENROUTER_API_KEY;
      }
    }
  });

  it("masks error body for auth failures", async () => {
    const originalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";

    try {
      mockErrorResponse(401, "key=sk-or-secret123");

      const result = await textToSpeech({
        text: "Hello",
        config: makeConfig(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Authentication failed");
      expect(result.error).not.toContain("sk-or-secret");
    } finally {
      if (originalKey) {
        process.env.OPENROUTER_API_KEY = originalKey;
      } else {
        delete process.env.OPENROUTER_API_KEY;
      }
    }
  });

  it("handles fetch timeout", async () => {
    const originalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";

    try {
      const abortError = new DOMException("The operation was aborted", "AbortError");
      mockFetch.mockRejectedValueOnce(abortError);

      const result = await textToSpeech({
        text: "Hello",
        config: makeConfig({ tts: { timeoutMs: 1 } }),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    } finally {
      if (originalKey) {
        process.env.OPENROUTER_API_KEY = originalKey;
      } else {
        delete process.env.OPENROUTER_API_KEY;
      }
    }
  });

  it("uses API key from config over env", async () => {
    const originalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "env-key";

    try {
      mockSuccessResponse();

      await textToSpeech({
        text: "Hello",
        config: makeConfig({ tts: { apiKey: "config-key" } }),
      });

      const [, opts] = mockFetch.mock.calls[0]!;
      expect(opts.headers.Authorization).toBe("Bearer config-key");
    } finally {
      if (originalKey) {
        process.env.OPENROUTER_API_KEY = originalKey;
      } else {
        delete process.env.OPENROUTER_API_KEY;
      }
    }
  });
});
