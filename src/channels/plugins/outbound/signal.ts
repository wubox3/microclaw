import type { ChannelOutboundAdapter } from "../types.js";

export function createSignalOutbound(): ChannelOutboundAdapter {
  return {
    textChunkLimit: 4000,
    sendText: async ({ to, text }) => {
      // TODO: Implement signal-cli send
      return { ok: false, messageId: undefined };
    },
  };
}
