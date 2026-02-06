import type { ChannelOutboundAdapter } from "../types.js";

export function createIMessageOutbound(): ChannelOutboundAdapter {
  return {
    textChunkLimit: 4000,
    sendText: async ({ to, text }) => {
      // TODO: Implement iMessage send
      return { ok: false, messageId: undefined };
    },
  };
}
