import type { MicroClawConfig } from "../config/types.js";
import type { TtsResult, ResolvedTtsConfig } from "./types.js";
import { createLogger } from "../logging.js";

const log = createLogger("tts");

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini-tts";
const DEFAULT_OPENAI_VOICE = "alloy";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TEXT_LENGTH = 4096;

const OPENAI_TTS_VOICES = [
  "alloy", "ash", "coral", "echo", "fable",
  "onyx", "nova", "sage", "shimmer",
] as const;

function getOpenAITtsBaseUrl(): string {
  return (
    process.env.OPENAI_TTS_BASE_URL?.trim() || "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
}

function isCustomEndpoint(): boolean {
  return getOpenAITtsBaseUrl() !== "https://api.openai.com/v1";
}

function isValidVoice(voice: string): boolean {
  if (isCustomEndpoint()) return true;
  return (OPENAI_TTS_VOICES as readonly string[]).includes(voice);
}

export function resolveTtsConfig(config: MicroClawConfig): ResolvedTtsConfig {
  const raw = config.voice?.tts ?? {};
  return {
    enabled: raw.enabled ?? false,
    provider: raw.provider ?? "openai",
    openai: {
      apiKey: raw.openai?.apiKey,
      model: raw.openai?.model ?? DEFAULT_OPENAI_MODEL,
      voice: raw.openai?.voice ?? DEFAULT_OPENAI_VOICE,
    },
    maxTextLength: raw.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH,
    timeoutMs: raw.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

function resolveApiKey(resolved: ResolvedTtsConfig): string | undefined {
  return resolved.openai.apiKey ?? process.env.OPENAI_API_KEY;
}

async function openaiTTS(params: {
  text: string;
  apiKey: string;
  model: string;
  voice: string;
  timeoutMs: number;
}): Promise<Buffer> {
  const { text, apiKey, model, voice, timeoutMs } = params;

  if (!isValidVoice(voice)) {
    throw new Error(`Invalid voice: ${voice}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${getOpenAITtsBaseUrl()}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
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
        // Log full error internally but don't expose to callers
        const body = await response.text().catch(() => "");
        log.error(`OpenAI TTS API error (${response.status}): ${body.slice(0, 500)}`);
      }
      throw new Error(`OpenAI TTS API error (${response.status}): ${isAuthError ? "Authentication failed" : "Request failed"}`);
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
    return {
      success: false,
      error: "No OpenAI API key configured for TTS",
    };
  }

  const startTime = Date.now();

  try {
    const audioBuffer = await openaiTTS({
      text: params.text,
      apiKey,
      model: resolved.openai.model,
      voice: params.voice ?? resolved.openai.voice,
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
