import type { ChannelOutboundAdapter } from "../types.js";

export function createGoogleChatOutbound(): ChannelOutboundAdapter {
  return {
    textChunkLimit: 4000,
    sendText: async ({ to, text }) => {
      // TODO: Implement Google Chat API send
      return { ok: false, messageId: undefined };
    },
  };
}
