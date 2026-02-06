import type { ChannelOutboundAdapter } from "../types.js";

export function createDiscordOutbound(): ChannelOutboundAdapter {
  return {
    textChunkLimit: 2000,
    sendText: async ({ to, text }) => {
      // TODO: Implement Discord Bot API send
      return { ok: false, messageId: undefined };
    },
  };
}
