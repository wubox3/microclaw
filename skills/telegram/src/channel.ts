import { InputFile } from "grammy";
import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";
import {
  startTelegramGateway,
  type TelegramGatewayHandle,
} from "./gateway.js";

const TELEGRAM_CHAT_ID_RE = /^-?\d+$/;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB Telegram bot upload limit

export function createTelegramPlugin(): ChannelPlugin {
  let activeHandle: TelegramGatewayHandle | undefined;

  return {
    id: "telegram",
    meta: {
      id: "telegram",
      label: "Telegram",
      selectionLabel: "Telegram (Bot API)",
      blurb: "Register a bot with @BotFather and get going.",
    },
    capabilities: {
      chatTypes: ["direct", "group", "channel"],
      nativeCommands: true,
      blockStreaming: true,
      media: true,
    },
    config: {
      isConfigured: (cfg) =>
        Boolean(
          cfg.channels?.telegram?.token || process.env.TELEGRAM_BOT_TOKEN,
        ),
      isEnabled: (cfg) => cfg.channels?.telegram?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 4000,
      sendText: async ({ to, text }) => {
        if (!activeHandle) return { ok: false };
        if (!TELEGRAM_CHAT_ID_RE.test(to)) return { ok: false };
        try {
          const result = await activeHandle.bot.api.sendMessage(to, text);
          return { ok: true, messageId: String(result.message_id) };
        } catch {
          return { ok: false };
        }
      },
      sendMedia: async ({ to, media, mimeType, caption }) => {
        if (!activeHandle) return { ok: false };
        if (!TELEGRAM_CHAT_ID_RE.test(to)) return { ok: false };
        if (media.length > MAX_FILE_SIZE) return { ok: false };
        try {
          const file = new InputFile(media);
          const messageId = await sendMediaByMime(
            activeHandle,
            to,
            file,
            mimeType,
            caption,
          );
          return { ok: true, messageId };
        } catch {
          return { ok: false };
        }
      },
    },
    gateway: {
      startAccount: async ({ config, onMessage }) => {
        // Close existing handle to prevent polling leak on re-start
        if (activeHandle) {
          await activeHandle.stop();
          activeHandle = undefined;
        }

        const token =
          config.channels?.telegram?.token || process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
          throw new Error("Telegram bot token not configured");
        }

        activeHandle = await startTelegramGateway({
          token,
          allowFrom: config.channels?.telegram?.allowFrom,
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

async function sendMediaByMime(
  handle: TelegramGatewayHandle,
  to: string,
  file: InputFile,
  mimeType: string,
  caption?: string,
): Promise<string | undefined> {
  const { api } = handle.bot;

  if (mimeType.startsWith("image/")) {
    const r = await api.sendPhoto(to, file, { caption });
    return String(r.message_id);
  }
  if (mimeType.startsWith("video/")) {
    const r = await api.sendVideo(to, file, { caption });
    return String(r.message_id);
  }
  if (mimeType.startsWith("audio/")) {
    const r = await api.sendAudio(to, file, { caption });
    return String(r.message_id);
  }
  const r = await api.sendDocument(to, file, { caption });
  return String(r.message_id);
}
