import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";
import type { MicroClawConfig } from "../../../src/config/types.js";

function resolvePhoneNumber(cfg: MicroClawConfig): string | undefined {
  return process.env.WHATSAPP_PHONE_NUMBER || cfg.channels?.whatsapp?.accountId || undefined;
}

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
      isConfigured: (cfg) => Boolean(resolvePhoneNumber(cfg)),
      isEnabled: (cfg) => cfg.channels?.whatsapp?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 4000,
      sendText: async ({ config, to, text }) => {
        const _phone = resolvePhoneNumber(config);
        // TODO: Implement via Baileys
        return { ok: false };
      },
    },
  };
}
