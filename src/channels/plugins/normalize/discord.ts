import type { ChannelGroupContext, NormalizedChatType } from "../types.core.js";

export function normalizeDiscordChatType(raw?: string): NormalizedChatType {
  switch (raw?.toLowerCase()) {
    case "dm": return "direct";
    case "thread": return "thread";
    case "channel":
    default: return "channel";
  }
}

export function normalizeDiscordContext(params: {
  channelId: string;
  chatType?: string;
  senderId?: string;
  senderName?: string;
  guildName?: string;
}): ChannelGroupContext {
  return {
    channelId: "discord",
    groupId: params.channelId,
    groupName: params.guildName,
    senderId: params.senderId,
    senderName: params.senderName,
    chatType: normalizeDiscordChatType(params.chatType),
  };
}
