import {
  ChannelType,
  type TextChannel,
  type DMChannel,
  type ThreadChannel,
} from "discord.js";
import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";
import type { MicroClawConfig } from "../../../src/config/types.js";
import {
  startDiscordGateway,
  type DiscordGatewayHandle,
} from "./gateway.js";

type SendableChannel = TextChannel | DMChannel | ThreadChannel;

const SNOWFLAKE_RE = /^\d{17,20}$/;

let activeHandle: DiscordGatewayHandle | undefined;

function resolveToken(cfg: MicroClawConfig): string | undefined {
  return process.env.DISCORD_BOT_TOKEN ?? cfg.channels?.discord?.token ?? undefined;
}

async function fetchSendableChannel(
  channelId: string,
): Promise<SendableChannel | undefined> {
  if (!activeHandle) return undefined;
  if (!SNOWFLAKE_RE.test(channelId)) return undefined;
  try {
    const channel = await activeHandle.client.channels.fetch(channelId);
    if (!channel) return undefined;
    if (
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.DM ||
      channel.type === ChannelType.PublicThread ||
      channel.type === ChannelType.PrivateThread
    ) {
      return channel as SendableChannel;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function sanitizeExtension(mimeType: string): string {
  const raw = mimeType.split("/")[1] ?? "bin";
  return raw.replace(/[^a-zA-Z0-9]/g, "") || "bin";
}

export function createDiscordPlugin(): ChannelPlugin {
  return {
    id: "discord",
    meta: {
      id: "discord",
      label: "Discord",
      selectionLabel: "Discord (Bot API)",
      blurb: "Discord bot with slash commands and threads.",
    },
    capabilities: {
      chatTypes: ["direct", "channel", "thread"],
      reactions: true,
      media: true,
      threads: true,
    },
    config: {
      isConfigured: (cfg) => Boolean(resolveToken(cfg)),
      isEnabled: (cfg) => cfg.channels?.discord?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 2000,
      sendText: async ({ to, text }) => {
        const channel = await fetchSendableChannel(to);
        if (!channel) return { ok: false };
        try {
          const sent = await channel.send(text);
          return { ok: true, messageId: sent.id };
        } catch {
          return { ok: false };
        }
      },
      sendMedia: async ({ to, media, mimeType, caption }) => {
        const channel = await fetchSendableChannel(to);
        if (!channel) return { ok: false };
        try {
          const extension = sanitizeExtension(mimeType);
          const sent = await channel.send({
            content: caption ?? undefined,
            files: [
              {
                attachment: media,
                name: `file.${extension}`,
              },
            ],
          });
          return { ok: true, messageId: sent.id };
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

        const token = resolveToken(config);
        if (!token) {
          throw new Error(
            "Discord bot token not configured. Set DISCORD_BOT_TOKEN env var or channels.discord.token in config.",
          );
        }

        const allowFrom = config.channels?.discord?.allowFrom;

        activeHandle = await startDiscordGateway({
          token,
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
