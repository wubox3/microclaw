import type { ChannelId, NormalizedChatType } from "./plugins/types.js";

export type ChannelSession = {
  channelId: ChannelId;
  accountId: string;
  chatId: string;
  chatType: NormalizedChatType;
  startedAt: number;
};

export function createChannelSession(params: {
  channelId: ChannelId;
  accountId?: string;
  chatId: string;
  chatType?: NormalizedChatType;
}): ChannelSession {
  return {
    channelId: params.channelId,
    accountId: params.accountId ?? "default",
    chatId: params.chatId,
    chatType: params.chatType ?? "direct",
    startedAt: Date.now(),
  };
}
