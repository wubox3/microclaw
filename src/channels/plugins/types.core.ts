export type ChannelId = ChatChannelId | string;

export type ChatChannelId = "telegram" | "whatsapp" | "discord" | "googlechat" | "slack" | "signal" | "imessage" | "twitter";

export type NormalizedChatType = "direct" | "group" | "channel" | "thread";

export type ChannelMeta = {
  id: string;
  label: string;
  selectionLabel?: string;
  detailLabel?: string;
  blurb?: string;
  aliases?: string[];
  order?: number;
};

export type ChannelCapabilities = {
  chatTypes: NormalizedChatType[];
  polls?: boolean;
  reactions?: boolean;
  media?: boolean;
  nativeCommands?: boolean;
  threads?: boolean;
  blockStreaming?: boolean;
};

export type ChannelAccountSnapshot = {
  channelId: ChannelId;
  accountId: string;
  connected: boolean;
  enabled: boolean;
  configured: boolean;
};

export type ChannelGroupContext = {
  channelId: ChannelId;
  groupId: string;
  groupName?: string;
  senderId?: string;
  senderName?: string;
  chatType: NormalizedChatType;
};

export type ChannelThreadingContext = {
  currentChannelId?: string;
  currentThreadTs?: string;
  hasRepliedRef?: boolean;
};

export type ChannelLogSink = {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
};
