export type { TtsConfig, VoiceWakeConfigOptions, VoiceConfig } from "../config/types.js";

export type TtsProvider = "openai";

export type VoiceWakeConfig = {
  triggers: string[];
  updatedAtMs: number;
};

export type TtsResult = {
  success: boolean;
  audioBuffer?: Buffer;
  error?: string;
  latencyMs?: number;
  contentType?: string;
};

export type ResolvedTtsConfig = {
  enabled: boolean;
  provider: TtsProvider;
  openai: {
    apiKey?: string;
    model: string;
    voice: string;
  };
  maxTextLength: number;
  timeoutMs: number;
};
