import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";

export function createGoogleChatPlugin(): ChannelPlugin {
  return {
    id: "googlechat",
    meta: {
      id: "googlechat",
      label: "Google Chat",
      selectionLabel: "Google Chat (Chat API)",
      blurb: "Google Workspace Chat app with HTTP webhook.",
      aliases: ["google-chat", "gchat"],
    },
    capabilities: {
      chatTypes: ["direct", "group", "thread"],
      reactions: true,
      media: true,
      threads: true,
      blockStreaming: true,
    },
    config: {
      isConfigured: (cfg) => Boolean(cfg.channels?.googlechat?.token),
      isEnabled: (cfg) => cfg.channels?.googlechat?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 4000,
      sendText: async ({ to, text }) => {
        // TODO: Implement via Google Chat API
        return { ok: false };
      },
    },
  };
}
