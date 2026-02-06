import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";

export function createDiscordPlugin(): ChannelPlugin {
  return {
    id: "discord",
    meta: {
      id: "discord",
      label: "Discord",
      selectionLabel: "Discord (Bot API)",
      blurb: "Discord bot with slash commands and threads.",
    },
    capabilities: {
      chatTypes: ["direct", "channel", "thread"],
      polls: true,
      reactions: true,
      media: true,
      nativeCommands: true,
      threads: true,
    },
    config: {
      isConfigured: (cfg) => Boolean(cfg.channels?.discord?.token),
      isEnabled: (cfg) => cfg.channels?.discord?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 2000,
      sendText: async ({ to, text }) => {
        // TODO: Implement via Discord.js
        return { ok: false };
      },
    },
  };
}
