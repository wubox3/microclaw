import type { ChannelGroupContext, NormalizedChatType } from "../types.core.js";

export function normalizeGoogleChatType(raw?: string): NormalizedChatType {
  switch (raw?.toLowerCase()) {
    case "dm": return "direct";
    case "thread": return "thread";
    case "space":
    case "room":
    default: return "group";
  }
}

export function normalizeGoogleChatContext(params: {
  spaceId: string;
  chatType?: string;
  senderId?: string;
  senderName?: string;
  spaceName?: string;
}): ChannelGroupContext {
  return {
    channelId: "googlechat",
    groupId: params.spaceId,
    groupName: params.spaceName,
    senderId: params.senderId,
    senderName: params.senderName,
    chatType: normalizeGoogleChatType(params.chatType),
  };
}
