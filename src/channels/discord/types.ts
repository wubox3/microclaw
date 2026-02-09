import type { Agent } from "../../agent/agent.js";
import type { WebMonitor } from "../web/monitor.js";
import type { MemorySearchManager } from "../../memory/types.js";
import type { EClawConfig } from "../../config/types.js";

export type DiscordGatewayParams = {
  readonly config: EClawConfig;
  readonly agent: Agent;
  readonly webMonitor: WebMonitor;
  readonly memoryManager?: MemorySearchManager;
};

export type DiscordGatewayHandle = {
  readonly stop: () => void;
};

export type DiscordApiError = {
  readonly code?: number;
  readonly message?: string;
};

export type DiscordUser = {
  readonly id: string;
  readonly username: string;
  readonly discriminator?: string;
  readonly global_name?: string;
  readonly bot?: boolean;
};

export type DiscordChannel = {
  readonly id: string;
  readonly type: number;
  readonly name?: string;
  readonly guild_id?: string;
  readonly last_message_id?: string;
};

export type DiscordMessage = {
  readonly id: string;
  readonly channel_id: string;
  readonly author: DiscordUser;
  readonly content: string;
  readonly timestamp: string;
  readonly type: number;
  readonly mentions: ReadonlyArray<DiscordUser>;
};

/** Discord channel types */
export const DISCORD_CHANNEL_TYPE = {
  GUILD_TEXT: 0,
  DM: 1,
  GUILD_VOICE: 2,
  GROUP_DM: 3,
  GUILD_CATEGORY: 4,
  GUILD_ANNOUNCEMENT: 5,
  ANNOUNCEMENT_THREAD: 10,
  PUBLIC_THREAD: 11,
  PRIVATE_THREAD: 12,
  GUILD_STAGE_VOICE: 13,
  GUILD_DIRECTORY: 14,
  GUILD_FORUM: 15,
  GUILD_MEDIA: 16,
} as const;
