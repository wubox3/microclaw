import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";
import type { MicroClawConfig } from "../../../src/config/types.js";
import { startGoogleChatGateway, type GoogleChatGatewayHandle } from "./gateway.js";

function resolveCredentialsPath(_cfg: MicroClawConfig): string | undefined {
  return process.env.GOOGLE_CHAT_CREDENTIALS || undefined;
}

function resolveVerificationToken(cfg: MicroClawConfig): string | undefined {
  return process.env.GOOGLE_CHAT_VERIFICATION_TOKEN || cfg.channels?.googlechat?.token || undefined;
}

export function createGoogleChatPlugin(): ChannelPlugin {
  let activeHandle: GoogleChatGatewayHandle | undefined;

  return {
    id: "googlechat",
    meta: {
      id: "googlechat",
      label: "Google Chat",
      selectionLabel: "Google Chat (Chat API)",
      blurb: "Google Workspace Chat app with HTTP webhook.",
      aliases: ["google-chat", "gchat"],
    },
    capabilities: {
      chatTypes: ["direct", "group", "thread"],
      reactions: true,
      media: true,
      threads: true,
      blockStreaming: true,
    },
    config: {
      isConfigured: (cfg) =>
        Boolean(
          process.env.GOOGLE_CHAT_CREDENTIALS ||
          process.env.GOOGLE_APPLICATION_CREDENTIALS ||
          cfg.channels?.googlechat?.token,
        ),
      isEnabled: (cfg) => cfg.channels?.googlechat?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 4096,
      sendText: async ({ to, text }) => {
        if (!activeHandle) {
          return { ok: false };
        }
        try {
          return await activeHandle.sendMessage(to, text);
        } catch {
          return { ok: false };
        }
      },
      sendMedia: async ({ to, media, mimeType, caption }) => {
        if (!activeHandle) {
          return { ok: false };
        }
        try {
          return await activeHandle.sendMedia(to, media, mimeType, caption);
        } catch {
          return { ok: false };
        }
      },
    },
    gateway: {
      startAccount: async ({ config, onMessage }) => {
        // Stop existing handle to prevent server leak on re-start
        if (activeHandle) {
          await activeHandle.stop();
          activeHandle = undefined;
        }

        const credentialsPath = resolveCredentialsPath(config);
        const verificationToken = resolveVerificationToken(config);
        const allowFrom = config.channels?.googlechat?.allowFrom;

        activeHandle = await startGoogleChatGateway({
          credentialsPath,
          verificationToken,
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
