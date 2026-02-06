import type { ChannelGroupContext, NormalizedChatType } from "../types.core.js";

export function normalizeSignalChatType(isGroup: boolean): NormalizedChatType {
  return isGroup ? "group" : "direct";
}

export function normalizeSignalContext(params: {
  chatId: string;
  isGroup: boolean;
  senderId?: string;
  senderName?: string;
  groupName?: string;
}): ChannelGroupContext {
  return {
    channelId: "signal",
    groupId: params.chatId,
    groupName: params.groupName,
    senderId: params.senderId,
    senderName: params.senderName,
    chatType: normalizeSignalChatType(params.isGroup),
  };
}
