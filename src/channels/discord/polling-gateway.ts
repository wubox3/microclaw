import { createLogger } from "../../logging.js";
import { formatError } from "../../infra/errors.js";
import type {
  DiscordGatewayParams,
  DiscordGatewayHandle,
  DiscordUser,
  DiscordChannel,
  DiscordMessage,
} from "./types.js";
import { DISCORD_CHANNEL_TYPE } from "./types.js";

const log = createLogger("discord");

const CHANNEL_ID = "discord";
const MAX_TEXT_LENGTH = 2000;
const POLL_INTERVAL_MS = 3000;
const INITIAL_POLL_DELAY_MS = 500;
const HISTORY_LIMIT = 50;
const MAX_CHANNELS_PER_TICK = 3;
const CHANNEL_REFRESH_MS = 60000;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 60000;
const MAX_API_RETRIES = 3;
const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_EPOCH = 1420070400000;

const MSG_TYPE_DEFAULT = 0;
const MSG_TYPE_REPLY = 19;

/** Create a Discord snowflake ID from a timestamp (for "after" pagination). */
function snowflakeFromTimestamp(timestamp: number): string {
  return String((BigInt(timestamp - DISCORD_EPOCH) << 22n));
}

function resolveToken(params: DiscordGatewayParams): string | null {
  const fromEnv = process.env.DISCORD_BOT_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const fromConfig = params.config.channels?.discord?.token?.trim();
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

function isDmChannel(channel: DiscordChannel): boolean {
  return channel.type === DISCORD_CHANNEL_TYPE.DM || channel.type === DISCORD_CHANNEL_TYPE.GROUP_DM;
}

function isTextChannel(channel: DiscordChannel): boolean {
  return (
    channel.type === DISCORD_CHANNEL_TYPE.GUILD_TEXT ||
    channel.type === DISCORD_CHANNEL_TYPE.DM ||
    channel.type === DISCORD_CHANNEL_TYPE.GROUP_DM ||
    channel.type === DISCORD_CHANNEL_TYPE.PUBLIC_THREAD ||
    channel.type === DISCORD_CHANNEL_TYPE.PRIVATE_THREAD ||
    channel.type === DISCORD_CHANNEL_TYPE.GUILD_ANNOUNCEMENT
  );
}

function parseRetryAfter(headerValue: string | null): number {
  const raw = parseFloat(headerValue ?? "5");
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 0.5), 300) : 5;
}

async function discordApi<T>(
  token: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  retryCount = 0,
): Promise<T | null> {
  const url = `${DISCORD_API_BASE}${path}`;
  try {
    const options: RequestInit = {
      method,
      headers: {
        "Authorization": `Bot ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "EClaw (https://github.com/bowu/eclaw, 1.0)",
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (response.status === 429) {
      if (retryCount >= MAX_API_RETRIES) {
        log.error(`Discord API ${path} rate limited ${retryCount} times, giving up`);
        return null;
      }
      const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
      const isGlobal = response.headers.get("X-RateLimit-Global") === "true";
      log.warn(`Discord API ${path} ${isGlobal ? "GLOBAL " : ""}rate limited, retrying after ${retryAfter}s (attempt ${retryCount + 1}/${MAX_API_RETRIES})`);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return discordApi(token, method, path, body, retryCount + 1);
    }

    if (response.status === 204) return null;

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown");
      log.warn(`Discord API ${method} ${path} failed (${response.status}): ${errorText}`);
      return null;
    }

    return (await response.json()) as T;
  } catch (err) {
    log.warn(`Discord API ${method} ${path} error: ${formatError(err)}`);
    return null;
  }
}

export function startDiscordPollingGateway(
  params: DiscordGatewayParams,
): DiscordGatewayHandle | null {
  const { config, agent, webMonitor, memoryManager } = params;

  const token = resolveToken(params);
  if (!token) {
    log.info("No Discord bot token found, skipping");
    return null;
  }
  const validToken: string = token;

  const allowFrom = config.channels?.discord?.allowFrom;
  const processingChannels = new Set<string>();
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let botUserId = "";

  // Track last-seen message ID per channel (snowflake IDs are sortable)
  const channelLastMessageId = new Map<string, string>();

  // Cached DM channels and guild channels the bot can see
  let cachedChannels: ReadonlyArray<DiscordChannel> = [];
  let lastChannelRefresh = 0;
  let channelPollIndex = 0;

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

  async function sendReply(channelId: string, text: string): Promise<boolean> {
    const truncated = text.length > MAX_TEXT_LENGTH
      ? text.slice(0, MAX_TEXT_LENGTH - 3) + "..."
      : text;

    const result = await discordApi<DiscordMessage>(
      validToken,
      "POST",
      `/channels/${channelId}/messages`,
      { content: truncated },
    );

    return result !== null;
  }

  function resolveDisplayName(author: DiscordUser): string {
    return author.global_name || author.username || author.id;
  }

  async function handleMessage(
    userId: string,
    senderName: string,
    text: string,
    timestamp: number,
    discordChannelId: string,
  ): Promise<void> {
    if (processingChannels.has(discordChannelId)) {
      log.info(`Skipping message from ${discordChannelId}, still processing previous`);
      return;
    }
    processingChannels.add(discordChannelId);

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
        const sent = await sendReply(discordChannelId, response.text);
        if (sent) {
          broadcastToUi({
            from: "assistant",
            text: response.text,
            senderName: "EClaw",
            timestamp: Date.now(),
            isFromSelf: false,
          });
        } else {
          log.warn(`Failed to send reply to channel ${discordChannelId}`);
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
      processingChannels.delete(discordChannelId);
    }
  }

  async function refreshChannels(): Promise<void> {
    const now = Date.now();
    if (now - lastChannelRefresh < CHANNEL_REFRESH_MS && cachedChannels.length > 0) {
      return;
    }

    // Fetch DM channels and guild list in parallel
    const [dmChannels, guilds] = await Promise.all([
      discordApi<ReadonlyArray<DiscordChannel>>(validToken, "GET", "/users/@me/channels"),
      discordApi<ReadonlyArray<{ readonly id: string; readonly name: string }>>(validToken, "GET", "/users/@me/guilds"),
    ]);

    const allChannels: DiscordChannel[] = [];

    if (dmChannels) {
      for (const ch of dmChannels) {
        if (isTextChannel(ch)) {
          allChannels.push(ch);
        }
      }
    }

    // Fetch guild channels in parallel
    if (guilds) {
      const guildResults = await Promise.allSettled(
        guilds.map((guild) =>
          discordApi<ReadonlyArray<DiscordChannel>>(validToken, "GET", `/guilds/${guild.id}/channels`),
        ),
      );
      for (const result of guildResults) {
        if (result.status === "fulfilled" && result.value) {
          for (const ch of result.value) {
            if (isTextChannel(ch)) {
              allChannels.push(ch);
            }
          }
        }
      }
    }

    cachedChannels = allChannels;
    lastChannelRefresh = now;

    // Seed last-message IDs for newly discovered channels
    const nowSnowflake = snowflakeFromTimestamp(now);
    for (const ch of cachedChannels) {
      if (!channelLastMessageId.has(ch.id)) {
        channelLastMessageId.set(ch.id, ch.last_message_id ?? nowSnowflake);
      }
    }

    log.debug(`Refreshed channels: ${cachedChannels.length} active (${dmChannels?.length ?? 0} DMs, ${guilds?.length ?? 0} guilds)`);
  }

  function shouldProcessMessage(
    msg: DiscordMessage,
    channel: DiscordChannel,
  ): { process: boolean; text: string } {
    if (msg.author.bot) return { process: false, text: "" };
    if (msg.author.id === botUserId) return { process: false, text: "" };
    if (!msg.content.trim()) return { process: false, text: "" };
    if (msg.type !== MSG_TYPE_DEFAULT && msg.type !== MSG_TYPE_REPLY) return { process: false, text: "" };

    // DMs: process all text messages
    if (isDmChannel(channel)) {
      return { process: true, text: msg.content };
    }

    // Guild channels: only process messages that @mention the bot
    const isMentioned = msg.mentions.some((u) => u.id === botUserId);
    if (!isMentioned) return { process: false, text: "" };

    // Strip the @mention from the text
    const cleanedText = msg.content.replaceAll(`<@${botUserId}>`, "").trim();
    if (!cleanedText) return { process: false, text: "" };

    return { process: true, text: cleanedText };
  }

  async function pollMessages(): Promise<void> {
    if (stopped) return;

    try {
      await refreshChannels();

      if (cachedChannels.length === 0) {
        reconnectAttempts = 0;
        return;
      }

      const channelsToCheck = Math.min(MAX_CHANNELS_PER_TICK, cachedChannels.length);

      for (let i = 0; i < channelsToCheck; i++) {
        if (stopped) break;

        const idx = channelPollIndex % cachedChannels.length;
        channelPollIndex += 1;
        const channel = cachedChannels[idx];

        const afterId = channelLastMessageId.get(channel.id);
        if (!afterId) continue;

        const messages = await discordApi<ReadonlyArray<DiscordMessage>>(
          validToken,
          "GET",
          `/channels/${channel.id}/messages?after=${afterId}&limit=10`,
        );

        if (!messages || messages.length === 0) continue;

        // Messages come newest-first, reverse to process chronologically
        const chronological = [...messages].reverse();

        // Update the last message ID to the newest
        channelLastMessageId.set(channel.id, messages[0].id);

        for (const msg of chronological) {
          const { process, text } = shouldProcessMessage(msg, channel);
          if (!process) continue;

          if (!isAllowed(msg.author.id, allowFrom)) {
            log.info(`Message from ${msg.author.id} blocked by allowFrom filter`);
            continue;
          }

          const senderName = resolveDisplayName(msg.author);
          const timestamp = new Date(msg.timestamp).getTime();

          handleMessage(msg.author.id, senderName, text, timestamp, channel.id).catch(
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
    const me = await discordApi<DiscordUser>(validToken, "GET", "/users/@me");

    if (!me) {
      log.error("Failed to verify bot token, Discord gateway not started");
      return;
    }

    botUserId = me.id;
    log.info(`Bot verified: ${me.username} (${me.id})`);

    // Fetch initial channel list (seeds last_message_id via refreshChannels)
    await refreshChannels();

    log.info(
      `Polling started (${POLL_INTERVAL_MS}ms interval, ${cachedChannels.length} channels, max ${MAX_CHANNELS_PER_TICK}/tick)`,
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
    log.error(`Discord gateway startup failed: ${formatError(err)}`);
  });

  log.info("Discord gateway starting...");

  return {
    stop: () => {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      log.info("Discord gateway stopped");
    },
  };
}
