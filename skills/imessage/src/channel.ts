import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";

export function createIMessagePlugin(): ChannelPlugin {
  return {
    id: "imessage",
    meta: {
      id: "imessage",
      label: "iMessage",
      selectionLabel: "iMessage",
      blurb: "iMessage integration (macOS only).",
      aliases: ["imsg"],
    },
    capabilities: {
      chatTypes: ["direct", "group"],
      reactions: true,
      media: true,
    },
    config: {
      isConfigured: () => process.platform === "darwin",
      isEnabled: (cfg) => cfg.channels?.imessage?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 4000,
      sendText: async ({ to, text }) => {
        // TODO: Implement via AppleScript/imsg
        return { ok: false };
      },
    },
  };
}
