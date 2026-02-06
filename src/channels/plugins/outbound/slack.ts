import type { ChannelOutboundAdapter } from "../types.js";

export function createSlackOutbound(): ChannelOutboundAdapter {
  return {
    textChunkLimit: 4000,
    sendText: async ({ to, text }) => {
      // TODO: Implement Slack Socket Mode send
      return { ok: false, messageId: undefined };
    },
  };
}
