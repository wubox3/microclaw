import type { ChannelId } from "./plugins/types.js";

export type SenderIdentity = {
  channelId: ChannelId;
  senderId: string;
  displayName?: string;
  isBot?: boolean;
};

export function createSenderIdentity(params: {
  channelId: ChannelId;
  senderId: string;
  displayName?: string;
  isBot?: boolean;
}): SenderIdentity {
  return { ...params };
}
