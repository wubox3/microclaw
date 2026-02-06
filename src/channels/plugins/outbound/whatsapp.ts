import type { ChannelOutboundAdapter } from "../types.js";

export function createWhatsAppOutbound(): ChannelOutboundAdapter {
  return {
    textChunkLimit: 4000,
    sendText: async ({ to, text }) => {
      // TODO: Implement WhatsApp Web send
      return { ok: false, messageId: undefined };
    },
  };
}
