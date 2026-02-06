import type { ChannelMeta, ChatChannelId } from "./plugins/types.js";

export const CHAT_CHANNEL_ORDER: readonly ChatChannelId[] = [
  "telegram",
  "whatsapp",
  "discord",
  "googlechat",
  "slack",
  "signal",
  "imessage",
] as const;

export const CHANNEL_IDS = [...CHAT_CHANNEL_ORDER] as const;

export const DEFAULT_CHAT_CHANNEL: ChatChannelId = "whatsapp";

const CHAT_CHANNEL_META: Record<ChatChannelId, ChannelMeta> = {
  telegram: {
    id: "telegram",
    label: "Telegram",
    selectionLabel: "Telegram (Bot API)",
    blurb: "Register a bot with @BotFather and get going.",
  },
  whatsapp: {
    id: "whatsapp",
    label: "WhatsApp",
    selectionLabel: "WhatsApp (QR link)",
    blurb: "Works with your own number via WhatsApp Web.",
  },
  discord: {
    id: "discord",
    label: "Discord",
    selectionLabel: "Discord (Bot API)",
    blurb: "Discord bot with slash commands and threads.",
  },
  googlechat: {
    id: "googlechat",
    label: "Google Chat",
    selectionLabel: "Google Chat (Chat API)",
    blurb: "Google Workspace Chat app with HTTP webhook.",
    aliases: ["google-chat", "gchat"],
  },
  slack: {
    id: "slack",
    label: "Slack",
    selectionLabel: "Slack (Socket Mode)",
    blurb: "Slack bot with Socket Mode.",
  },
  signal: {
    id: "signal",
    label: "Signal",
    selectionLabel: "Signal (signal-cli)",
    blurb: "Signal via signal-cli linked device.",
  },
  imessage: {
    id: "imessage",
    label: "iMessage",
    selectionLabel: "iMessage",
    blurb: "iMessage integration (macOS only).",
    aliases: ["imsg"],
  },
};

export const CHAT_CHANNEL_ALIASES: Record<string, ChatChannelId> = {
  imsg: "imessage",
  "google-chat": "googlechat",
  gchat: "googlechat",
};

export function listChatChannels(): ChannelMeta[] {
  return CHAT_CHANNEL_ORDER.map((id) => CHAT_CHANNEL_META[id]);
}

export function getChatChannelMeta(id: ChatChannelId): ChannelMeta {
  return CHAT_CHANNEL_META[id];
}

export function normalizeChatChannelId(raw?: string | null): ChatChannelId | null {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const resolved = CHAT_CHANNEL_ALIASES[normalized] ?? normalized;
  return (CHAT_CHANNEL_ORDER as readonly string[]).includes(resolved)
    ? (resolved as ChatChannelId)
    : null;
}
