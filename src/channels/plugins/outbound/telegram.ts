import type { ChannelOutboundAdapter } from "../types.js";

export function createTelegramOutbound(): ChannelOutboundAdapter {
  return {
    textChunkLimit: 4000,
    sendText: async ({ to, text }) => {
      // TODO: Implement Telegram Bot API send
      return { ok: false, messageId: undefined };
    },
  };
}
