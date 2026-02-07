import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  type Message,
  ChannelType,
} from "discord.js";
import type { GatewayInboundMessage } from "../../../src/channels/plugins/types.js";

const MAX_MESSAGE_LENGTH = 8000;

export type DiscordGatewayHandle = {
  readonly client: Client;
  readonly stop: () => Promise<void>;
};

export type DiscordGatewayParams = {
  token: string;
  allowFrom?: string[];
  onMessage: (msg: GatewayInboundMessage) => Promise<void>;
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
};

function isAllowed(userId: string, allowFrom: string[] | undefined): boolean {
  if (!allowFrom || allowFrom.length === 0) return true;
  return allowFrom.includes(userId);
}

function resolveChatType(message: Message): "direct" | "channel" | "thread" {
  if (message.channel.type === ChannelType.DM) return "direct";
  if (message.channel.isThread()) return "thread";
  return "channel";
}

export async function startDiscordGateway(
  params: DiscordGatewayParams,
): Promise<DiscordGatewayHandle> {
  const { token, onMessage, allowFrom, logger } = params;

  let stopped = false;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.on(Events.ClientReady, () => {
    logger?.info(`Discord bot connected as ${client.user?.tag ?? "unknown"}`);
  });

  client.on(Events.Error, (error) => {
    logger?.error(`Discord client error: ${error.message}`);
  });

  client.on(Events.MessageCreate, (message) => {
    try {
      processMessage(message);
    } catch (err) {
      logger?.error(
        `Failed to process Discord message: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  const processMessage = (message: Message): void => {
    // Skip messages from bots (including ourselves)
    if (message.author.bot) return;

    // Apply allowFrom filter
    if (!isAllowed(message.author.id, allowFrom)) return;

    // Extract text content
    const rawText = message.content;
    if (!rawText || rawText.trim().length === 0) return;

    // Truncate oversized messages
    const text =
      rawText.length > MAX_MESSAGE_LENGTH
        ? rawText.slice(0, MAX_MESSAGE_LENGTH)
        : rawText;

    const chatType = resolveChatType(message);
    const chatId = message.channelId;

    const inbound: GatewayInboundMessage = {
      from: message.author.id,
      text,
      chatType,
      chatId,
      timestamp: message.createdTimestamp,
      senderName:
        message.member?.displayName ?? message.author.displayName ?? undefined,
    };

    onMessage(inbound).catch((err) => {
      logger?.error(
        `Gateway onMessage handler failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  await client.login(token);

  const handle: DiscordGatewayHandle = {
    get client() {
      return client;
    },
    stop: async () => {
      stopped = true;
      await client.destroy();
    },
  };

  return handle;
}
