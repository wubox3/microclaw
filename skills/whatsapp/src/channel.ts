import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";
import type { MicroClawConfig } from "../../../src/config/types.js";
import { startWhatsAppGateway, type WhatsAppGatewayHandle } from "./gateway.js";

let activeHandle: WhatsAppGatewayHandle | undefined;

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
      sendText: async ({ to, text }) => {
        if (!activeHandle) {
          return { ok: false };
        }
        try {
          const sent = await activeHandle.sock.sendMessage(to, { text });
          return { ok: true, messageId: sent?.key?.id ?? undefined };
        } catch {
          return { ok: false };
        }
      },
      sendMedia: async ({ to, media, mimeType, caption }) => {
        if (!activeHandle) {
          return { ok: false };
        }
        try {
          const content = buildMediaContent(media, mimeType, caption);
          if (!content) return { ok: false };
          const sent = await activeHandle.sock.sendMessage(to, content);
          return { ok: true, messageId: sent?.key?.id ?? undefined };
        } catch {
          return { ok: false };
        }
      },
    },
    gateway: {
      startAccount: async ({ config, onMessage }) => {
        // Close existing handle to prevent socket leak on re-start
        if (activeHandle) {
          await activeHandle.stop();
          activeHandle = undefined;
        }

        const allowFrom = config.channels?.whatsapp?.allowFrom;

        activeHandle = await startWhatsAppGateway({
          allowFrom,
          onMessage: onMessage ?? (async () => {}),
        });

        return activeHandle;
      },
      stopAccount: async () => {
        if (activeHandle) {
          await activeHandle.stop();
          activeHandle = undefined;
        }
      },
    },
  };
}

function buildMediaContent(
  media: Buffer,
  mimeType: string,
  caption?: string,
): Record<string, unknown> | undefined {
  if (mimeType.startsWith("image/")) {
    return { image: media, caption, mimetype: mimeType };
  }
  if (mimeType.startsWith("video/")) {
    return { video: media, caption, mimetype: mimeType };
  }
  if (mimeType.startsWith("audio/")) {
    return { audio: media, mimetype: mimeType, ptt: mimeType === "audio/ogg" };
  }
  // Default to document for everything else
  return { document: media, caption, mimetype: mimeType };
}
