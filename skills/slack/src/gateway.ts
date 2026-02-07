import { App, type GenericMessageEvent } from "@slack/bolt";
import type { GatewayInboundMessage } from "../../../src/channels/plugins/types.js";
import type { NormalizedChatType } from "../../../src/channels/plugins/types.core.js";

const MAX_MESSAGE_LENGTH = 8000;

export type SlackGatewayHandle = {
  readonly app: App;
  readonly stop: () => Promise<void>;
};

export type SlackGatewayParams = {
  botToken: string;
  appToken: string;
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

function resolveChatType(channelType: string | undefined): NormalizedChatType {
  if (channelType === "im") return "direct";
  if (channelType === "mpim") return "group";
  return "channel";
}

function resolveTimestamp(ts: string): number {
  const parsed = parseFloat(ts);
  return Number.isFinite(parsed) ? Math.round(parsed * 1000) : Date.now();
}

export async function startSlackGateway(
  params: SlackGatewayParams,
): Promise<SlackGatewayHandle> {
  const { botToken, appToken, onMessage, allowFrom, logger } = params;

  let stopped = false;

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
  });

  app.message(async ({ message }) => {
    try {
      // Only process generic (user-sent) messages, skip bot messages and subtypes
      const msg = message as GenericMessageEvent;
      if (!msg.user) return;
      if ("bot_id" in msg && msg.bot_id) return;
      if (msg.subtype) return;

      // Apply allowFrom filter
      if (!isAllowed(msg.user, allowFrom)) return;

      const rawText = msg.text ?? "";
      if (rawText.trim().length === 0) return;

      const text =
        rawText.length > MAX_MESSAGE_LENGTH
          ? rawText.slice(0, MAX_MESSAGE_LENGTH)
          : rawText;

      const isThread = Boolean(msg.thread_ts && msg.thread_ts !== msg.ts);
      const chatType: NormalizedChatType = isThread
        ? "thread"
        : resolveChatType(msg.channel_type);

      const inbound: GatewayInboundMessage = {
        from: msg.user,
        text,
        chatType,
        chatId: msg.channel,
        timestamp: resolveTimestamp(msg.ts),
        senderName: undefined,
      };

      await onMessage(inbound);
    } catch (err) {
      logger?.error(
        `Failed to process Slack message: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  app.error(async (error) => {
    logger?.error(`Slack app error: ${error.message}`);
  });

  await app.start();
  logger?.info("Slack bot connected via Socket Mode");

  const handle: SlackGatewayHandle = {
    get app() {
      return app;
    },
    stop: async () => {
      stopped = true;
      await app.stop();
    },
  };

  return handle;
}
