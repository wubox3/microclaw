import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";

export function createSlackPlugin(): ChannelPlugin {
  return {
    id: "slack",
    meta: {
      id: "slack",
      label: "Slack",
      selectionLabel: "Slack (Socket Mode)",
      blurb: "Slack bot with Socket Mode.",
    },
    capabilities: {
      chatTypes: ["direct", "channel", "thread"],
      reactions: true,
      media: true,
      nativeCommands: true,
      threads: true,
    },
    config: {
      isConfigured: (cfg) => Boolean(cfg.channels?.slack?.token),
      isEnabled: (cfg) => cfg.channels?.slack?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 4000,
      sendText: async ({ to, text }) => {
        // TODO: Implement via @slack/bolt
        return { ok: false };
      },
    },
  };
}
