import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";

export function createWhatsAppPlugin(): ChannelPlugin {
  return {
    id: "whatsapp",
    meta: {
      id: "whatsapp",
      label: "WhatsApp",
      selectionLabel: "WhatsApp (QR link)",
      blurb: "Works with your own number via WhatsApp Web.",
    },
    capabilities: {
      chatTypes: ["direct", "group"],
      polls: true,
      reactions: true,
      media: true,
    },
    config: {
      isConfigured: () => true,
      isEnabled: (cfg) => cfg.channels?.whatsapp?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 4000,
      sendText: async ({ to, text }) => {
        // TODO: Implement via Baileys
        return { ok: false };
      },
    },
  };
}
