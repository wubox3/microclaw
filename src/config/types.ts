import type { z } from "zod";

export type ChatChannelId = "telegram" | "whatsapp" | "discord" | "googlechat" | "slack" | "signal" | "imessage";

export type ChannelConfig = {
  enabled?: boolean;
  accountId?: string;
  token?: string;
  allowFrom?: string[];
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
  directory?: string;
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

export type MicroClawConfig = {
  channels?: Partial<Record<ChatChannelId, ChannelConfig>>;
  memory?: MemoryConfig;
  agent?: AgentConfig;
  skills?: SkillConfig;
  web?: WebConfig;
  container?: ContainerConfigOptions;
};
