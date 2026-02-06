import type { MicroClawConfig } from "../config/types.js";
import type { ChannelPlugin } from "../channels/plugins/types.js";

export type SkillDefinition = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  configSchema?: SkillConfigSchema;
  register: (api: SkillApi) => void | Promise<void>;
};

export type SkillConfigSchema = {
  type: "object";
  properties?: Record<string, { type: string; description?: string; default?: unknown }>;
  required?: string[];
};

export type SkillLogger = {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
  debug: (msg: string, ...args: unknown[]) => void;
};

export type SkillApi = {
  id: string;
  name: string;
  config: MicroClawConfig;
  skillConfig?: Record<string, unknown>;
  logger: SkillLogger;
  registerTool: (tool: AgentTool | SkillToolFactory) => void;
  registerChannel: (channel: ChannelPlugin) => void;
};

export type AgentTool = {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (params: Record<string, unknown>, context: SkillToolContext) => Promise<AgentToolResult>;
};

export type AgentToolResult = {
  content: string;
  isError?: boolean;
};

export type SkillToolFactory = {
  factory: true;
  create: (context: SkillToolContext) => AgentTool | AgentTool[];
};

export type SkillToolContext = {
  sessionKey: string;
  channelId: string;
  chatId: string;
  config: MicroClawConfig;
};

// Re-export ChannelPlugin type reference for skills that register channels
export type { ChannelPlugin } from "../channels/plugins/types.js";
