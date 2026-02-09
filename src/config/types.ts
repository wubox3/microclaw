import type { ChatChannelId } from "../channels/plugins/types.core.js";
import type { BrowserConfig } from "../browser/types.js";

export type { ChatChannelId } from "../channels/plugins/types.core.js";
export type { BrowserConfig } from "../browser/types.js";

export type ChannelConfig = {
  enabled?: boolean;
  accountId?: string;
  token?: string;
  allowFrom?: string[];
  binPath?: string;
  provider?: string;
};

export type MemoryConfig = {
  enabled?: boolean;
  dataDir?: string;
  embeddingModel?: string;
  vectorWeight?: number;
  keywordWeight?: number;
  maxResults?: number;
};

export type LlmProvider = "anthropic" | "openrouter";

export type AgentConfig = {
  provider?: LlmProvider;
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  temperature?: number;
};

export type SkillConfig = {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
};

export type SkillsLoadConfig = {
  extraDirs?: string[];
  watch?: boolean;
  watchDebounceMs?: number;
};

export type SkillsInstallConfig = {
  preferBrew?: boolean;
  nodeManager?: "npm" | "pnpm" | "yarn" | "bun";
};

export type SkillsConfig = {
  allowBundled?: string[];
  load?: SkillsLoadConfig;
  install?: SkillsInstallConfig;
  entries?: Record<string, SkillConfig>;
};

export type WebConfig = {
  port?: number;
  host?: string;
};

export type ContainerConfigOptions = {
  enabled?: boolean;
  image?: string;
  timeout?: number;
  additionalMounts?: Array<{
    hostPath: string;
    containerPath: string;
    readonly?: boolean;
  }>;
};

export type TtsConfig = {
  enabled?: boolean;
  provider?: "openai" | "openrouter";
  apiKey?: string;
  model?: string;
  voice?: string;
  maxTextLength?: number;
  timeoutMs?: number;
};

export type VoiceWakeConfigOptions = {
  enabled?: boolean;
  triggers?: string[];
};

export type VoiceConfig = {
  tts?: TtsConfig;
  wake?: VoiceWakeConfigOptions;
  language?: string;
};

export type CronConfig = {
  enabled?: boolean;
  store?: string;
  maxConcurrentRuns?: number;
};

export type EClawConfig = {
  channels?: Partial<Record<ChatChannelId, ChannelConfig>>;
  memory?: MemoryConfig;
  agent?: AgentConfig;
  skills?: SkillsConfig;
  web?: WebConfig;
  container?: ContainerConfigOptions;
  voice?: VoiceConfig;
  browser?: BrowserConfig;
  cron?: CronConfig;
};
