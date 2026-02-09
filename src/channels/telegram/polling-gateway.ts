import { createLogger } from "../../logging.js";
import { formatError } from "../../infra/errors.js";
import type {
  TelegramGatewayParams,
  TelegramGatewayHandle,
  TelegramUpdate,
  TelegramApiResponse,
} from "./types.js";

const log = createLogger("telegram");

const CHANNEL_ID = "telegram";
const MAX_TEXT_LENGTH = 4000;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_S = 30;
const HISTORY_LIMIT = 50;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 60000;

function resolveToken(params: TelegramGatewayParams): string | null {
  const fromEnv = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const fromConfig = params.config.channels?.telegram?.token?.trim();
  if (fromConfig) return fromConfig;

  return null;
}

function isAllowed(
  from: { id: number; username?: string },
  allowFrom: string[] | undefined,
): boolean {
  if (!allowFrom || allowFrom.length === 0) return true;

  const userId = String(from.id);
  const username = from.username?.toLowerCase();

  return allowFrom.some((entry) => {
    const normalized = entry.trim().toLowerCase().replace(/^@/, "");
    return userId === normalized || (username !== undefined && username === normalized);
  });
}

function resolveSenderName(update: TelegramUpdate): string {
  const from = update.message?.from;
  if (!from) return "Unknown";

  const parts = [from.first_name, from.last_name].filter(Boolean);
  return parts.join(" ") || from.username || String(from.id);
}

async function telegramApi<T>(
  token: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<T | null> {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params ?? {}),
    });

    const data = (await response.json()) as TelegramApiResponse<T>;
    if (!data.ok) {
      log.warn(`Telegram API ${method} failed: ${data.description ?? "unknown error"}`);
      return null;
    }
    return data.result ?? null;
  } catch (err) {
    log.warn(`Telegram API ${method} error: ${formatError(err)}`);
    return null;
  }
}

export function startTelegramPollingGateway(
  params: TelegramGatewayParams,
): TelegramGatewayHandle | null {
  const { config, agent, webMonitor, memoryManager } = params;

  const token = resolveToken(params);
  if (!token) {
    log.info("No Telegram bot token found, skipping");
    return null;
  }

  const allowFrom = config.channels?.telegram?.allowFrom;
  const processingChats = new Set<string>();
  let stopped = false;
  let offset = 0;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;

  function broadcastToUi(msg: {
    from: string;
    text: string;
    senderName: string;
    timestamp: number;
    isFromSelf: boolean;
  }): void {
    webMonitor.broadcast(JSON.stringify({
      type: "channel_message",
      channelId: CHANNEL_ID,
      from: msg.from,
      text: msg.text,
      senderName: msg.senderName,
      timestamp: msg.timestamp,
      isFromSelf: msg.isFromSelf,
    }));
  }

  async function sendReply(chatId: number, text: string): Promise<boolean> {
    const truncated = text.length > MAX_TEXT_LENGTH
      ? text.slice(0, MAX_TEXT_LENGTH) + "..."
      : text;

    const result = await telegramApi(token!, "sendMessage", {
      chat_id: chatId,
      text: truncated,
      parse_mode: "Markdown",
    });

    if (!result) {
      // Retry without parse_mode in case Markdown fails
      const plain = await telegramApi(token!, "sendMessage", {
        chat_id: chatId,
        text: truncated,
      });
      return plain !== null;
    }
    return true;
  }

  async function handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message) return;

    const text = message.text ?? message.caption;
    if (!text) return;

    const from = message.from;
    if (!from || from.is_bot) return;

    if (!isAllowed(from, allowFrom)) {
      log.info(`Message from ${from.id} blocked by allowFrom filter`);
      return;
    }

    const chatId = String(message.chat.id);
    const senderName = resolveSenderName(update);
    const timestamp = message.date * 1000;
    const trimmedText = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;

    if (processingChats.has(chatId)) {
      log.info(`Skipping message from ${chatId}, still processing previous`);
      return;
    }
    processingChats.add(chatId);

    try {
      broadcastToUi({ from: chatId, text: trimmedText, senderName, timestamp, isFromSelf: true });

      const historyMessages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> = [];
      if (memoryManager) {
        try {
          const history = await memoryManager.loadChatHistory({
            channelId: CHANNEL_ID,
            limit: HISTORY_LIMIT,
          });
          for (const msg of history) {
            historyMessages.push({ role: msg.role, content: msg.content, timestamp: msg.timestamp });
          }
        } catch {
          // History loading is non-fatal
        }
      }

      const response = await agent.chat({
        messages: [
          ...historyMessages,
          { role: "user", content: trimmedText, timestamp },
        ],
        channelId: CHANNEL_ID,
      });

      if (response.text) {
        const sent = await sendReply(message.chat.id, response.text);
        if (sent) {
          broadcastToUi({
            from: "assistant",
            text: response.text,
            senderName: "EClaw",
            timestamp: Date.now(),
            isFromSelf: false,
          });
        } else {
          log.warn(`Failed to send reply to chat ${chatId}`);
        }
      }

      if (memoryManager && response.text) {
        memoryManager.saveExchange({
          channelId: CHANNEL_ID,
          userMessage: trimmedText,
          assistantMessage: response.text,
          timestamp,
        }).catch((err) => {
          log.warn(`Failed to persist exchange: ${formatError(err)}`);
        });
      }
    } catch (err) {
      log.error(`Message handling failed: ${formatError(err)}`);
    } finally {
      processingChats.delete(chatId);
    }
  }

  async function pollUpdates(): Promise<void> {
    if (stopped) return;

    try {
      const updates = await telegramApi<TelegramUpdate[]>(token!, "getUpdates", {
        offset,
        limit: 20,
        timeout: POLL_TIMEOUT_S,
        allowed_updates: ["message"],
      });

      if (!updates || updates.length === 0) {
        reconnectAttempts = 0;
        return;
      }

      reconnectAttempts = 0;

      for (const update of updates) {
        offset = update.update_id + 1;
        handleUpdate(update).catch((err: unknown) => {
          log.error(`handleUpdate error: ${formatError(err)}`);
        });
      }
    } catch (err) {
      log.warn(`Poll error: ${formatError(err)}`);
      reconnectAttempts += 1;

      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        log.error(`Exceeded ${MAX_RECONNECT_ATTEMPTS} poll failures, stopping`);
        stopped = true;
        return;
      }

      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
        MAX_RECONNECT_DELAY_MS,
      );
      log.info(`Retrying poll in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  async function startPolling(): Promise<void> {
    // Verify token before starting
    const me = await telegramApi<{ id: number; first_name: string; username?: string }>(
      token!,
      "getMe",
    );
    if (!me) {
      log.error("Failed to verify bot token, Telegram gateway not started");
      return;
    }
    log.info(`Bot verified: @${me.username ?? me.first_name} (${me.id})`);

    // Flush pending updates so we don't process old messages
    await telegramApi(token!, "getUpdates", { offset: -1, limit: 1 });
    const flush = await telegramApi<TelegramUpdate[]>(token!, "getUpdates", {
      offset: -1,
      limit: 1,
    });
    if (flush && flush.length > 0) {
      offset = flush[flush.length - 1].update_id + 1;
    }

    log.info(`Polling started (${POLL_INTERVAL_MS}ms interval, ${POLL_TIMEOUT_S}s long-poll)`);

    const tick = async () => {
      await pollUpdates();
      if (!stopped) {
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
        pollTimer.unref();
      }
    };

    pollTimer = setTimeout(tick, 500);
    pollTimer.unref();
  }

  startPolling().catch((err) => {
    log.error(`Telegram gateway startup failed: ${formatError(err)}`);
  });

  log.info("Telegram gateway starting...");

  return {
    stop: () => {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      log.info("Telegram gateway stopped");
    },
  };
}
