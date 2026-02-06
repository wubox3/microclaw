import type { ChannelGroupContext, NormalizedChatType } from "../types.core.js";

export function normalizeIMessageChatType(isGroup: boolean): NormalizedChatType {
  return isGroup ? "group" : "direct";
}

export function normalizeIMessageContext(params: {
  chatId: string;
  isGroup: boolean;
  senderId?: string;
  senderName?: string;
  groupName?: string;
}): ChannelGroupContext {
  return {
    channelId: "imessage",
    groupId: params.chatId,
    groupName: params.groupName,
    senderId: params.senderId,
    senderName: params.senderName,
    chatType: normalizeIMessageChatType(params.isGroup),
  };
}
