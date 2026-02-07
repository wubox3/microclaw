import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";
import type { MicroClawConfig } from "../../../src/config/types.js";
import { startSlackGateway, type SlackGatewayHandle } from "./gateway.js";

const SLACK_CHANNEL_ID_RE = /^[CDGW][A-Z0-9]{8,}$/;

let activeHandle: SlackGatewayHandle | undefined;

function resolveBotToken(cfg: MicroClawConfig): string | undefined {
  return process.env.SLACK_BOT_TOKEN ?? cfg.channels?.slack?.token ?? undefined;
}

function resolveAppToken(cfg: MicroClawConfig): string | undefined {
  if (process.env.SLACK_APP_TOKEN) {
    return process.env.SLACK_APP_TOKEN;
  }
  const slack = cfg.channels?.slack as Record<string, unknown> | undefined;
  const appToken = slack?.appToken;
  return typeof appToken === "string" ? appToken : undefined;
}

export function createSlackPlugin(): ChannelPlugin {
  return {
    id: "slack",
    meta: {
      id: "slack",
      label: "Slack",
      selectionLabel: "Slack (Socket Mode)",
      blurb: "Slack bot with Socket Mode.",
    },
    capabilities: {
      chatTypes: ["direct", "channel", "thread"],
      reactions: true,
      media: true,
      threads: true,
    },
    config: {
      isConfigured: (cfg) =>
        Boolean(resolveBotToken(cfg)) && Boolean(resolveAppToken(cfg)),
      isEnabled: (cfg) => cfg.channels?.slack?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 4000,
      sendText: async ({ to, text }) => {
        if (!activeHandle) return { ok: false };
        if (!SLACK_CHANNEL_ID_RE.test(to)) return { ok: false };
        try {
          const result = await activeHandle.app.client.chat.postMessage({
            channel: to,
            text,
          });
          return {
            ok: Boolean(result.ok),
            messageId: result.ts ?? undefined,
          };
        } catch {
          return { ok: false };
        }
      },
      sendMedia: async ({ to, media, mimeType, caption }) => {
        if (!activeHandle) return { ok: false };
        if (!SLACK_CHANNEL_ID_RE.test(to)) return { ok: false };
        try {
          const extension = mimeType.split("/")[1]?.replace(/[^a-zA-Z0-9]/g, "") || "bin";
          const uploadResult = await activeHandle.app.client.filesUploadV2({
            channel_id: to,
            file: media,
            filename: `file.${extension}`,
            initial_comment: caption ?? undefined,
          });
          return {
            ok: Boolean(uploadResult.ok),
            messageId: undefined,
          };
        } catch {
          return { ok: false };
        }
      },
    },
    gateway: {
      startAccount: async ({ config, onMessage }) => {
        if (activeHandle) {
          await activeHandle.stop();
          activeHandle = undefined;
        }

        const botToken = resolveBotToken(config);
        if (!botToken) {
          throw new Error(
            "Slack bot token not configured. Set SLACK_BOT_TOKEN env var or channels.slack.token in config.",
          );
        }

        const appToken = resolveAppToken(config);
        if (!appToken) {
          throw new Error(
            "Slack app-level token not configured. Set SLACK_APP_TOKEN env var or channels.slack.appToken in config.",
          );
        }

        const allowFrom = config.channels?.slack?.allowFrom;

        activeHandle = await startSlackGateway({
          botToken,
          appToken,
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
