export type SessionKey = {
  channelId: string;
  accountId: string;
  chatId: string;
};

export function deriveSessionKey(params: {
  channelId: string;
  accountId?: string;
  chatId: string;
}): string {
  const parts = [
    params.channelId,
    params.accountId ?? "default",
    params.chatId,
  ];
  return parts.join(":");
}

export function parseSessionKey(key: string): SessionKey | null {
  const parts = key.split(":");
  if (parts.length < 3) {
    return null;
  }
  return {
    channelId: parts[0]!,
    accountId: parts[1]!,
    chatId: parts.slice(2).join(":"),
  };
}

export type SessionStore = Map<string, SessionState>;

export type SessionState = {
  key: string;
  channelId: string;
  accountId: string;
  chatId: string;
  createdAt: number;
  lastMessageAt: number;
  messageCount: number;
};

export function createSessionStore(): SessionStore {
  return new Map();
}

export function getOrCreateSession(
  store: SessionStore,
  params: { channelId: string; accountId?: string; chatId: string },
): SessionState {
  const key = deriveSessionKey(params);
  const existing = store.get(key);
  if (existing) {
    return {
      ...existing,
      lastMessageAt: Date.now(),
      messageCount: existing.messageCount + 1,
    };
  }
  const session: SessionState = {
    key,
    channelId: params.channelId,
    accountId: params.accountId ?? "default",
    chatId: params.chatId,
    createdAt: Date.now(),
    lastMessageAt: Date.now(),
    messageCount: 1,
  };
  store.set(key, session);
  return session;
}
