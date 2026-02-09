import { createLogger } from "../../logging.js";
import { formatError } from "../../infra/errors.js";
import type {
  SlackGatewayParams,
  SlackGatewayHandle,
  SlackApiResponse,
  SlackMessage,
  SlackConversation,
} from "./types.js";

const log = createLogger("slack");

const CHANNEL_ID = "slack";
const MAX_TEXT_LENGTH = 4000;
const POLL_INTERVAL_MS = 3000;
const INITIAL_POLL_DELAY_MS = 500;
const HISTORY_LIMIT = 50;
const MAX_CONVERSATIONS_PER_TICK = 2;
const CONVERSATION_REFRESH_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 60000;
const MAX_API_RETRIES = 3;

function resolveToken(params: SlackGatewayParams): string | null {
  const fromEnv = process.env.SLACK_BOT_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const fromConfig = params.config.channels?.slack?.token?.trim();
  if (fromConfig) return fromConfig;

  return null;
}

function isAllowed(
  userId: string,
  allowFrom: string[] | undefined,
): boolean {
  if (!allowFrom || allowFrom.length === 0) return true;
  return allowFrom.some((entry) => entry.trim() === userId);
}

async function slackApi<T>(
  token: string,
  method: string,
  params?: Record<string, unknown>,
  retryCount = 0,
): Promise<T | null> {
  const url = `https://slack.com/api/${method}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(params ?? {}),
    });

    if (response.status === 429) {
      if (retryCount >= MAX_API_RETRIES) {
        log.error(`Slack API ${method} rate limited ${retryCount} times, giving up`);
        return null;
      }
      const retryAfter = parseInt(response.headers.get("Retry-After") ?? "5", 10);
      log.warn(`Slack API ${method} rate limited, retrying after ${retryAfter}s (attempt ${retryCount + 1}/${MAX_API_RETRIES})`);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return slackApi(token, method, params, retryCount + 1);
    }

    const data = (await response.json()) as SlackApiResponse<T>;
    if (!data.ok) {
      log.warn(`Slack API ${method} failed: ${data.error ?? "unknown error"}`);
      return null;
    }
    return data as T;
  } catch (err) {
    log.warn(`Slack API ${method} error: ${formatError(err)}`);
    return null;
  }
}

export function startSlackPollingGateway(
  params: SlackGatewayParams,
): SlackGatewayHandle | null {
  const { config, agent, webMonitor, memoryManager } = params;

  const token = resolveToken(params);
  if (!token) {
    log.info("No Slack bot token found, skipping");
    return null;
  }
  const validToken: string = token;

  const allowFrom = config.channels?.slack?.allowFrom;
  const processingConversations = new Set<string>();
  const userNameCache = new Map<string, string>();
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let botUserId = "";

  // Track last-seen timestamp per conversation to avoid reprocessing
  const conversationTimestamps = new Map<string, string>();

  // Cached conversation list and refresh timing
  let cachedConversations: ReadonlyArray<SlackConversation> = [];
  let lastConversationRefresh = 0;
  let conversationPollIndex = 0;

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

  async function sendReply(channel: string, text: string): Promise<boolean> {
    const truncated = text.length > MAX_TEXT_LENGTH
      ? text.slice(0, MAX_TEXT_LENGTH) + "..."
      : text;

    const result = await slackApi<{ readonly ts: string }>(validToken, "chat.postMessage", {
      channel,
      text: truncated,
    });

    return result !== null;
  }

  async function resolveUserName(userId: string): Promise<string> {
    const cached = userNameCache.get(userId);
    if (cached) return cached;

    const info = await slackApi<{
      readonly user: { readonly real_name?: string; readonly name?: string };
    }>(validToken, "users.info", { user: userId });

    const name = info ? (info.user.real_name || info.user.name || userId) : userId;
    userNameCache.set(userId, name);
    return name;
  }

  async function handleMessage(
    userId: string,
    senderName: string,
    text: string,
    timestamp: number,
    conversationId: string,
  ): Promise<void> {
    if (processingConversations.has(conversationId)) {
      log.info(`Skipping message from ${conversationId}, still processing previous`);
      return;
    }
    processingConversations.add(conversationId);

    try {
      const trimmedText = text.length > MAX_TEXT_LENGTH
        ? text.slice(0, MAX_TEXT_LENGTH)
        : text;

      broadcastToUi({
        from: userId,
        text: trimmedText,
        senderName,
        timestamp,
        isFromSelf: true,
      });

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
        const sent = await sendReply(conversationId, response.text);
        if (sent) {
          broadcastToUi({
            from: "assistant",
            text: response.text,
            senderName: "EClaw",
            timestamp: Date.now(),
            isFromSelf: false,
          });
        } else {
          log.warn(`Failed to send reply to conversation ${conversationId}`);
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
      processingConversations.delete(conversationId);
    }
  }

  async function refreshConversations(): Promise<void> {
    const now = Date.now();
    if (now - lastConversationRefresh < CONVERSATION_REFRESH_MS && cachedConversations.length > 0) {
      return;
    }

    const result = await slackApi<{
      readonly channels: ReadonlyArray<SlackConversation>;
    }>(validToken, "conversations.list", {
      types: "im,mpim,public_channel,private_channel",
      limit: 200,
      exclude_archived: true,
    });

    if (result) {
      cachedConversations = result.channels.filter(
        (c) => c.is_im || c.is_mpim || c.is_member,
      );
      lastConversationRefresh = now;

      // Seed timestamps for newly discovered conversations so they get polled
      const nowTs = String(now / 1000);
      for (const conv of cachedConversations) {
        if (!conversationTimestamps.has(conv.id)) {
          conversationTimestamps.set(conv.id, nowTs);
        }
      }

      log.debug(`Refreshed conversations: ${cachedConversations.length} active`);
    }
  }

  function shouldProcessMessage(
    msg: SlackMessage,
    conversation: SlackConversation,
  ): { process: boolean; text: string } {
    if (msg.subtype) return { process: false, text: "" };
    if (msg.user === botUserId) return { process: false, text: "" };
    if (msg.bot_id) return { process: false, text: "" };
    if (!msg.text) return { process: false, text: "" };
    if (!msg.user) return { process: false, text: "" };

    // DMs: process all text messages
    if (conversation.is_im || conversation.is_mpim) {
      return { process: true, text: msg.text };
    }

    // Channels: only process messages containing @mention of bot
    const mentionPattern = `<@${botUserId}>`;
    if (!msg.text.includes(mentionPattern)) {
      return { process: false, text: "" };
    }

    // Strip the @mention from the text
    const cleanedText = msg.text.replaceAll(mentionPattern, "").trim();
    if (!cleanedText) return { process: false, text: "" };

    return { process: true, text: cleanedText };
  }

  async function pollMessages(): Promise<void> {
    if (stopped) return;

    try {
      await refreshConversations();

      if (cachedConversations.length === 0) {
        reconnectAttempts = 0;
        return;
      }

      const conversationsToCheck = Math.min(MAX_CONVERSATIONS_PER_TICK, cachedConversations.length);

      for (let i = 0; i < conversationsToCheck; i++) {
        if (stopped) break;

        const idx = conversationPollIndex % cachedConversations.length;
        conversationPollIndex += 1;
        const conversation = cachedConversations[idx];

        const oldest = conversationTimestamps.get(conversation.id);
        if (!oldest) continue;

        const result = await slackApi<{
          readonly messages: ReadonlyArray<SlackMessage>;
        }>(validToken, "conversations.history", {
          channel: conversation.id,
          oldest,
          limit: 10,
          inclusive: false,
        });

        if (!result || result.messages.length === 0) continue;

        // Messages come newest-first, reverse to process in chronological order
        const chronological = [...result.messages].reverse();

        // Update the timestamp to the latest message
        const latestTs = result.messages[0].ts;
        conversationTimestamps.set(conversation.id, latestTs);

        for (const msg of chronological) {
          const { process, text } = shouldProcessMessage(msg, conversation);
          if (!process) continue;

          if (!isAllowed(msg.user!, allowFrom)) {
            log.info(`Message from ${msg.user} blocked by allowFrom filter`);
            continue;
          }

          const senderName = await resolveUserName(msg.user!);
          const timestamp = Math.floor(parseFloat(msg.ts) * 1000);

          handleMessage(msg.user!, senderName, text, timestamp, conversation.id).catch(
            (err: unknown) => {
              log.error(`handleMessage error: ${formatError(err)}`);
            },
          );
        }
      }

      reconnectAttempts = 0;
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
    const authResult = await slackApi<{
      readonly user_id: string;
      readonly user: string;
      readonly team: string;
    }>(validToken, "auth.test", {});

    if (!authResult) {
      log.error("Failed to verify bot token, Slack gateway not started");
      return;
    }

    botUserId = authResult.user_id;
    log.info(`Bot verified: ${authResult.user} on ${authResult.team} (${botUserId})`);

    // Fetch initial conversation list (seeds timestamps via refreshConversations)
    await refreshConversations();

    log.info(
      `Polling started (${POLL_INTERVAL_MS}ms interval, ${cachedConversations.length} conversations, max ${MAX_CONVERSATIONS_PER_TICK}/tick)`,
    );

    const tick = async () => {
      await pollMessages();
      if (!stopped) {
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
        pollTimer.unref();
      }
    };

    pollTimer = setTimeout(tick, INITIAL_POLL_DELAY_MS);
    pollTimer.unref();
  }

  startPolling().catch((err) => {
    log.error(`Slack gateway startup failed: ${formatError(err)}`);
  });

  log.info("Slack gateway starting...");

  return {
    stop: () => {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      log.info("Slack gateway stopped");
    },
  };
}
