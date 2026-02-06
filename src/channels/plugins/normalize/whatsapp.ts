import type { ChannelGroupContext, NormalizedChatType } from "../types.core.js";

export function normalizeWhatsAppChatType(jid: string): NormalizedChatType {
  if (jid.endsWith("@g.us")) {
    return "group";
  }
  return "direct";
}

export function normalizeWhatsAppTarget(target: string): string {
  return target.replace(/[^+\d@.a-z]/gi, "");
}

export function normalizeWhatsAppContext(params: {
  chatId: string;
  senderId?: string;
  senderName?: string;
  groupName?: string;
}): ChannelGroupContext {
  return {
    channelId: "whatsapp",
    groupId: params.chatId,
    groupName: params.groupName,
    senderId: params.senderId,
    senderName: params.senderName,
    chatType: normalizeWhatsAppChatType(params.chatId),
  };
}
