import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";

export function createSignalPlugin(): ChannelPlugin {
  return {
    id: "signal",
    meta: {
      id: "signal",
      label: "Signal",
      selectionLabel: "Signal (signal-cli)",
      blurb: "Signal via signal-cli linked device.",
    },
    capabilities: {
      chatTypes: ["direct", "group"],
      reactions: true,
      media: true,
    },
    config: {
      isConfigured: (cfg) => Boolean(cfg.channels?.signal?.token),
      isEnabled: (cfg) => cfg.channels?.signal?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 4000,
      sendText: async ({ to, text }) => {
        // TODO: Implement via signal-cli REST API
        return { ok: false };
      },
    },
  };
}
