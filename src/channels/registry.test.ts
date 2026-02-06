import { describe, it, expect } from "vitest";
import {
  listChatChannels,
  getChatChannelMeta,
  normalizeChatChannelId,
  CHAT_CHANNEL_ORDER,
  CHAT_CHANNEL_ALIASES,
  DEFAULT_CHAT_CHANNEL,
} from "./registry.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("CHAT_CHANNEL_ORDER", () => {
  it("has 7 channels", () => {
    expect(CHAT_CHANNEL_ORDER).toHaveLength(7);
  });

  it("contains all expected channels", () => {
    expect(CHAT_CHANNEL_ORDER).toContain("telegram");
    expect(CHAT_CHANNEL_ORDER).toContain("whatsapp");
    expect(CHAT_CHANNEL_ORDER).toContain("discord");
    expect(CHAT_CHANNEL_ORDER).toContain("googlechat");
    expect(CHAT_CHANNEL_ORDER).toContain("slack");
    expect(CHAT_CHANNEL_ORDER).toContain("signal");
    expect(CHAT_CHANNEL_ORDER).toContain("imessage");
  });
});

describe("DEFAULT_CHAT_CHANNEL", () => {
  it("is whatsapp", () => {
    expect(DEFAULT_CHAT_CHANNEL).toBe("whatsapp");
  });
});

// ---------------------------------------------------------------------------
// listChatChannels
// ---------------------------------------------------------------------------

describe("listChatChannels", () => {
  it("returns 7 channel meta objects", () => {
    const channels = listChatChannels();
    expect(channels).toHaveLength(7);
  });

  it("each channel has id and label", () => {
    for (const channel of listChatChannels()) {
      expect(channel.id).toBeTruthy();
      expect(channel.label).toBeTruthy();
    }
  });

  it("returns channels in correct order", () => {
    const channels = listChatChannels();
    const ids = channels.map((c) => c.id);
    expect(ids).toEqual([...CHAT_CHANNEL_ORDER]);
  });
});

// ---------------------------------------------------------------------------
// getChatChannelMeta
// ---------------------------------------------------------------------------

describe("getChatChannelMeta", () => {
  it("returns correct meta for telegram", () => {
    const meta = getChatChannelMeta("telegram");
    expect(meta.id).toBe("telegram");
    expect(meta.label).toBe("Telegram");
  });

  it("returns correct meta for whatsapp", () => {
    const meta = getChatChannelMeta("whatsapp");
    expect(meta.id).toBe("whatsapp");
    expect(meta.label).toBe("WhatsApp");
  });

  it("returns meta with selectionLabel for all channels", () => {
    for (const id of CHAT_CHANNEL_ORDER) {
      const meta = getChatChannelMeta(id);
      expect(meta.selectionLabel).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeChatChannelId
// ---------------------------------------------------------------------------

describe("normalizeChatChannelId", () => {
  it("returns exact match", () => {
    expect(normalizeChatChannelId("telegram")).toBe("telegram");
    expect(normalizeChatChannelId("whatsapp")).toBe("whatsapp");
    expect(normalizeChatChannelId("discord")).toBe("discord");
  });

  it("resolves imsg alias", () => {
    expect(normalizeChatChannelId("imsg")).toBe("imessage");
  });

  it("resolves gchat alias", () => {
    expect(normalizeChatChannelId("gchat")).toBe("googlechat");
  });

  it("resolves google-chat alias", () => {
    expect(normalizeChatChannelId("google-chat")).toBe("googlechat");
  });

  it("returns null for unknown channel", () => {
    expect(normalizeChatChannelId("unknown")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(normalizeChatChannelId(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeChatChannelId(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeChatChannelId("")).toBeNull();
  });

  it("handles case insensitive input", () => {
    expect(normalizeChatChannelId("Telegram")).toBe("telegram");
    expect(normalizeChatChannelId("DISCORD")).toBe("discord");
  });

  it("trims whitespace", () => {
    expect(normalizeChatChannelId("  slack  ")).toBe("slack");
  });
});

// ---------------------------------------------------------------------------
// CHAT_CHANNEL_ALIASES
// ---------------------------------------------------------------------------

describe("CHAT_CHANNEL_ALIASES", () => {
  it("maps imsg to imessage", () => {
    expect(CHAT_CHANNEL_ALIASES["imsg"]).toBe("imessage");
  });

  it("maps google-chat to googlechat", () => {
    expect(CHAT_CHANNEL_ALIASES["google-chat"]).toBe("googlechat");
  });

  it("maps gchat to googlechat", () => {
    expect(CHAT_CHANNEL_ALIASES["gchat"]).toBe("googlechat");
  });
});
