import type { ChannelGroupContext, NormalizedChatType } from "../types.core.js";

export function normalizeSlackChatType(raw?: string): NormalizedChatType {
  switch (raw?.toLowerCase()) {
    case "im":
    case "dm": return "direct";
    case "thread": return "thread";
    case "channel":
    case "group":
    default: return "channel";
  }
}

export function normalizeSlackContext(params: {
  channelId: string;
  chatType?: string;
  senderId?: string;
  senderName?: string;
  channelName?: string;
}): ChannelGroupContext {
  return {
    channelId: "slack",
    groupId: params.channelId,
    groupName: params.channelName,
    senderId: params.senderId,
    senderName: params.senderName,
    chatType: normalizeSlackChatType(params.chatType),
  };
}
