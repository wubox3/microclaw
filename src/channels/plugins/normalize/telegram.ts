import type { ChannelGroupContext, NormalizedChatType } from "../types.core.js";

export function normalizeTelegramChatType(raw?: string): NormalizedChatType {
  switch (raw?.toLowerCase()) {
    case "private": return "direct";
    case "group":
    case "supergroup": return "group";
    case "channel": return "channel";
    default: return "direct";
  }
}

export function normalizeTelegramContext(params: {
  chatId: string;
  chatType?: string;
  senderId?: string;
  senderName?: string;
  groupName?: string;
}): ChannelGroupContext {
  return {
    channelId: "telegram",
    groupId: params.chatId,
    groupName: params.groupName,
    senderId: params.senderId,
    senderName: params.senderName,
    chatType: normalizeTelegramChatType(params.chatType),
  };
}
