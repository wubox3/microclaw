import type { MicroClawConfig } from "../config/types.js";
import type { TtsResult, TtsProvider, ResolvedTtsConfig } from "./types.js";
import { createLogger } from "../logging.js";

const log = createLogger("tts");

const DEFAULT_MODEL = "openai/tts-1";
const DEFAULT_VOICE = "alloy";
const DEFAULT_PROVIDER: TtsProvider = "openrouter";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TEXT_LENGTH = 4096;

const KNOWN_VOICES = [
  "alloy", "ash", "coral", "echo", "fable",
  "onyx", "nova", "sage", "shimmer",
] as const;

const PROVIDER_BASE_URLS: Record<TtsProvider, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
};

function getBaseUrl(provider: TtsProvider): string {
  const envOverride = provider === "openrouter"
    ? process.env.OPENROUTER_TTS_BASE_URL?.trim()
    : process.env.OPENAI_TTS_BASE_URL?.trim();

  return (envOverride || PROVIDER_BASE_URLS[provider]).replace(/\/+$/, "");
}

function isKnownVoice(voice: string): boolean {
  return (KNOWN_VOICES as readonly string[]).includes(voice);
}

export function resolveTtsConfig(config: MicroClawConfig): ResolvedTtsConfig {
  const raw = config.voice?.tts ?? {};
  return {
    enabled: raw.enabled ?? true,
    provider: raw.provider ?? DEFAULT_PROVIDER,
    apiKey: raw.apiKey,
    model: raw.model ?? DEFAULT_MODEL,
    voice: raw.voice ?? DEFAULT_VOICE,
    maxTextLength: raw.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH,
    timeoutMs: raw.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

function resolveApiKey(resolved: ResolvedTtsConfig): string | undefined {
  if (resolved.apiKey) {
    return resolved.apiKey;
  }
  return resolved.provider === "openrouter"
    ? process.env.OPENROUTER_API_KEY
    : process.env.OPENAI_API_KEY;
}

function buildHeaders(provider: TtsProvider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/wubox3/microclaw";
    headers["X-Title"] = "MicroClaw";
  }

  return headers;
}

async function callTtsApi(params: {
  text: string;
  apiKey: string;
  model: string;
  voice: string;
  provider: TtsProvider;
  timeoutMs: number;
}): Promise<Buffer> {
  const { text, apiKey, model, voice, provider, timeoutMs } = params;

  if (!isKnownVoice(voice)) {
    log.warn(`Voice "${voice}" is not in the known voices list, passing through to API`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const baseUrl = getBaseUrl(provider);
    const response = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: buildHeaders(provider, apiKey),
      body: JSON.stringify({
        model,
        input: text,
        voice,
        response_format: "mp3",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const isAuthError = response.status === 401 || response.status === 403;
      if (!isAuthError) {
        log.error(`TTS API error (${provider}): HTTP ${response.status}`);
      }
      throw new Error(
        `TTS API error (${response.status}): ${isAuthError ? "Authentication failed" : "Request failed"}`,
      );
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

export async function textToSpeech(params: {
  text: string;
  config: MicroClawConfig;
  voice?: string;
}): Promise<TtsResult> {
  const resolved = resolveTtsConfig(params.config);

  if (!resolved.enabled) {
    return {
      success: false,
      error: "TTS is not enabled in configuration",
    };
  }

  if (!params.text.trim()) {
    return {
      success: false,
      error: "Text must not be empty or whitespace-only",
    };
  }

  if (params.text.length > resolved.maxTextLength) {
    return {
      success: false,
      error: `Text too long (${params.text.length} chars, max ${resolved.maxTextLength})`,
    };
  }

  const apiKey = resolveApiKey(resolved);
  if (!apiKey) {
    const envVar = resolved.provider === "openrouter"
      ? "OPENROUTER_API_KEY"
      : "OPENAI_API_KEY";
    return {
      success: false,
      error: `No API key configured for TTS (set ${envVar} or config voice.tts.apiKey)`,
    };
  }

  const startTime = Date.now();

  try {
    const audioBuffer = await callTtsApi({
      text: params.text,
      apiKey,
      model: resolved.model,
      voice: params.voice ?? resolved.voice,
      provider: resolved.provider,
      timeoutMs: resolved.timeoutMs,
    });

    return {
      success: true,
      audioBuffer,
      latencyMs: Date.now() - startTime,
      contentType: "audio/mpeg",
    };
  } catch (err) {
    const error = err as Error;
    const latencyMs = Date.now() - startTime;
    log.error(`TTS failed after ${latencyMs}ms: ${error.message}`);
    return {
      success: false,
      error: error.name === "AbortError"
        ? "TTS request timed out"
        : error.message,
      latencyMs,
    };
  }
}
