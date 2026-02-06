import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";

export function createTelegramPlugin(): ChannelPlugin {
  return {
    id: "telegram",
    meta: {
      id: "telegram",
      label: "Telegram",
      selectionLabel: "Telegram (Bot API)",
      blurb: "Register a bot with @BotFather and get going.",
    },
    capabilities: {
      chatTypes: ["direct", "group", "channel", "thread"],
      nativeCommands: true,
      blockStreaming: true,
    },
    config: {
      isConfigured: (cfg) => Boolean(cfg.channels?.telegram?.token),
      isEnabled: (cfg) => cfg.channels?.telegram?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 4000,
      sendText: async ({ to, text }) => {
        // TODO: Implement via Grammy/Telegram Bot API
        return { ok: false };
      },
    },
  };
}
