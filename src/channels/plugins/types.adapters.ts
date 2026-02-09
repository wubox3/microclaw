import type { EClawConfig } from "../../config/types.js";
import type { ChannelId, ChannelAccountSnapshot, ChannelGroupContext, NormalizedChatType } from "./types.core.js";

export type GatewayInboundMessage = {
  from: string;
  text: string;
  chatType: NormalizedChatType;
  chatId: string;
  timestamp: number;
  senderName?: string;
};

export type ChannelOutboundContext = {
  channelId: ChannelId;
  accountId?: string;
  chatId: string;
  chatType?: NormalizedChatType;
};

export type ChannelConfigAdapter<ResolvedAccount = unknown> = {
  listAccounts?: (cfg: EClawConfig) => string[];
  resolveAccount?: (params: { cfg: EClawConfig; accountId?: string | null }) => ResolvedAccount;
  isConfigured?: (cfg: EClawConfig, accountId?: string | null) => boolean;
  isEnabled?: (cfg: EClawConfig, accountId?: string | null) => boolean;
};

export type ChannelOutboundAdapter = {
  textChunkLimit?: number;
  sendText?: (params: {
    config: EClawConfig;
    accountId?: string;
    to: string;
    text: string;
    chatType?: NormalizedChatType;
  }) => Promise<{ ok: boolean; messageId?: string }>;
  sendMedia?: (params: {
    config: EClawConfig;
    accountId?: string;
    to: string;
    media: Buffer;
    mimeType: string;
    caption?: string;
  }) => Promise<{ ok: boolean; messageId?: string }>;
};

export type ChannelGatewayAdapter<ResolvedAccount = unknown> = {
  startAccount?: (params: {
    config: EClawConfig;
    accountId: string;
    account: ResolvedAccount;
    onMessage?: (msg: GatewayInboundMessage) => Promise<void>;
  }) => Promise<unknown>;
  stopAccount?: (params: {
    config: EClawConfig;
    accountId: string;
  }) => Promise<void>;
};

export type ChannelSecurityAdapter<ResolvedAccount = unknown> = {
  collectWarnings?: (params: {
    config: EClawConfig;
    accountId?: string;
  }) => Promise<string[]> | string[];
};

export type ChannelGroupAdapter = {
  resolveRequireMention?: (params: {
    config: EClawConfig;
    accountId?: string;
    groupContext: ChannelGroupContext;
  }) => boolean;
};

export type ChannelMentionAdapter = {
  stripPatterns?: (params: { ctx: Record<string, string | undefined> }) => string[];
};

export type ChannelStreamingAdapter = {
  blockStreamingCoalesceDefaults?: {
    minChars?: number;
    idleMs?: number;
  };
};

export type ChannelThreadingAdapter = {
  resolveReplyToMode?: (params: {
    cfg: EClawConfig;
    accountId?: string;
    chatType?: NormalizedChatType;
  }) => string;
  buildToolContext?: (params: {
    context: Record<string, string | undefined>;
    hasRepliedRef?: boolean;
  }) => import("./types.core.js").ChannelThreadingContext;
};
