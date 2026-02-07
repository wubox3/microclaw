import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";
import { startSignalGateway, type SignalGatewayHandle } from "./gateway.js";

const DEFAULT_SIGNAL_CLI_URL = "http://localhost:8080";
const PHONE_RE = /^\+?\d{7,15}$/;
const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024; // 100 MB

function resolveBaseUrl(): string {
  return process.env.SIGNAL_CLI_URL || DEFAULT_SIGNAL_CLI_URL;
}

function resolvePhoneNumber(cfg: { channels?: { signal?: { accountId?: string } } }): string | undefined {
  return process.env.SIGNAL_PHONE_NUMBER || cfg.channels?.signal?.accountId || undefined;
}

export function createSignalPlugin(): ChannelPlugin {
  let activeHandle: SignalGatewayHandle | undefined;

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
      isConfigured: (cfg) =>
        Boolean(resolvePhoneNumber(cfg)),
      isEnabled: (cfg) => cfg.channels?.signal?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 4000,
      sendText: async ({ to, text }) => {
        if (!activeHandle) return { ok: false };
        if (!PHONE_RE.test(to.replace(/[\s\-()]/g, ""))) return { ok: false };
        try {
          const result = await activeHandle.sendMessage(to, text);
          return { ok: result.ok, messageId: result.timestamp };
        } catch {
          return { ok: false };
        }
      },
      sendMedia: async ({ to, media, mimeType, caption }) => {
        if (!activeHandle) return { ok: false };
        if (!PHONE_RE.test(to.replace(/[\s\-()]/g, ""))) return { ok: false };
        if (media.length > MAX_ATTACHMENT_SIZE) return { ok: false };
        try {
          const result = await activeHandle.sendMedia(to, media, mimeType, caption);
          return { ok: result.ok, messageId: result.timestamp };
        } catch {
          return { ok: false };
        }
      },
    },
    gateway: {
      startAccount: async ({ config, onMessage }) => {
        // Close existing handle to prevent connection leak on re-start
        if (activeHandle) {
          await activeHandle.stop();
          activeHandle = undefined;
        }

        const phoneNumber = resolvePhoneNumber(config);
        if (!phoneNumber) {
          throw new Error("Signal phone number not configured");
        }

        activeHandle = await startSignalGateway({
          baseUrl: resolveBaseUrl(),
          phoneNumber,
          allowFrom: config.channels?.signal?.allowFrom,
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
