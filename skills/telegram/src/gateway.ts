import { Bot } from "grammy";
import type { GatewayInboundMessage } from "../../../src/channels/plugins/types.js";
import type { NormalizedChatType } from "../../../src/channels/plugins/types.core.js";

const MAX_MESSAGE_LENGTH = 8000;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 2000;

export type TelegramGatewayHandle = {
  readonly bot: Bot;
  readonly stop: () => Promise<void>;
};

export type TelegramGatewayParams = {
  token: string;
  allowFrom?: string[];
  onMessage: (msg: GatewayInboundMessage) => Promise<void>;
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
};

function mapChatType(type: string): NormalizedChatType {
  switch (type) {
    case "private":
      return "direct";
    case "group":
    case "supergroup":
      return "group";
    case "channel":
      return "channel";
    default:
      return "direct";
  }
}

function isAllowed(
  from: { id: number; username?: string },
  allowFrom: string[] | undefined,
): boolean {
  if (!allowFrom || allowFrom.length === 0) return true;
  const idStr = String(from.id);
  return allowFrom.some((entry) => {
    const cleaned = entry.replace(/^@/, "").trim();
    if (!cleaned) return false;
    return (
      cleaned === idStr ||
      (from.username != null &&
        cleaned.toLowerCase() === from.username.toLowerCase())
    );
  });
}

export async function startTelegramGateway(
  params: TelegramGatewayParams,
): Promise<TelegramGatewayHandle> {
  const { token, onMessage, allowFrom, logger } = params;

  const bot = new Bot(token);
  let stopped = false;

  bot.catch((err) => {
    const original =
      err.error instanceof Error ? err.error.message : String(err.error);
    logger?.error(
      `Telegram bot error (update ${err.ctx?.update?.update_id}): ${original}`,
    );
  });

  bot.on("message", async (ctx) => {
    const { message } = ctx;
    if (!message.from) return;

    if (!isAllowed(message.from, allowFrom)) return;

    const rawText = message.text ?? message.caption;
    if (!rawText) return;

    const text =
      rawText.length > MAX_MESSAGE_LENGTH
        ? rawText.slice(0, MAX_MESSAGE_LENGTH)
        : rawText;

    const chatType = mapChatType(message.chat.type);
    const senderName =
      [message.from.first_name, message.from.last_name]
        .filter(Boolean)
        .join(" ") || undefined;

    const inbound: GatewayInboundMessage = {
      from: String(message.from.id),
      text,
      chatType,
      chatId: String(message.chat.id),
      timestamp: message.date * 1000,
      senderName,
    };

    try {
      await onMessage(inbound);
    } catch (err) {
      logger?.error(
        `onMessage handler failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  // Validate token and fetch bot info before starting
  await bot.init();
  logger?.info(`Telegram bot @${bot.botInfo.username} initialized`);

  // Start long polling with reconnection logic
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const startPolling = (): void => {
    bot
      .start({
        onStart: () => {
          reconnectAttempts = 0;
          logger?.info("Telegram bot polling started");
        },
      })
      .catch((err) => {
        if (stopped) return;
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(
            BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts,
            60_000,
          );
          reconnectAttempts++;
          logger?.warn(
            `Telegram polling error, reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
          );
          reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined;
            if (!stopped) startPolling();
          }, delay);
        } else {
          logger?.error(
            `Telegram reconnection attempts exhausted: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
  };

  startPolling();

  return {
    bot,
    stop: async () => {
      stopped = true;
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      await bot.stop();
    },
  };
}
