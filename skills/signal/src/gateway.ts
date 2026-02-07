import type { GatewayInboundMessage } from "../../../src/channels/plugins/types.js";
import type { NormalizedChatType } from "../../../src/channels/plugins/types.core.js";

const MAX_MESSAGE_LENGTH = 8000;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const POLL_INTERVAL_MS = 1000;

export type SignalGatewayHandle = {
  readonly stop: () => Promise<void>;
  readonly sendMessage: (to: string, text: string) => Promise<{ ok: boolean; timestamp?: string }>;
  readonly sendMedia: (
    to: string,
    media: Buffer,
    mimeType: string,
    caption?: string,
  ) => Promise<{ ok: boolean; timestamp?: string }>;
};

export type SignalGatewayParams = {
  baseUrl: string;
  phoneNumber: string;
  allowFrom?: string[];
  onMessage: (msg: GatewayInboundMessage) => Promise<void>;
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
};

function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-+()]/g, "");
}

function isAllowed(sender: string, allowFrom: string[] | undefined): boolean {
  if (!allowFrom || allowFrom.length === 0) return true;
  const senderNorm = normalizePhone(sender);
  return allowFrom.some((entry) => normalizePhone(entry) === senderNorm);
}

function resolveTimestamp(ts: unknown): number {
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") {
    const parsed = Number(ts);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }
  return Date.now();
}

function determineChatType(envelope: Record<string, unknown>): NormalizedChatType {
  const dataMessage = envelope.dataMessage as Record<string, unknown> | undefined;
  if (dataMessage?.groupInfo || dataMessage?.group) return "group";
  return "direct";
}

function resolveChatId(
  envelope: Record<string, unknown>,
  sender: string,
): string {
  const dataMessage = envelope.dataMessage as Record<string, unknown> | undefined;
  const groupInfo = (dataMessage?.groupInfo ?? dataMessage?.group) as
    | Record<string, unknown>
    | undefined;
  if (groupInfo) {
    return String(groupInfo.groupId ?? groupInfo.id ?? sender);
  }
  return sender;
}

export async function startSignalGateway(
  params: SignalGatewayParams,
): Promise<SignalGatewayHandle> {
  const { baseUrl, phoneNumber, onMessage, allowFrom, logger } = params;
  const apiBase = baseUrl.replace(/\/+$/, "");

  let stopped = false;
  let reconnectAttempts = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let ws: WebSocket | undefined;

  const processEnvelope = (envelope: Record<string, unknown>): void => {
    const source = envelope.source ?? envelope.sourceNumber;
    if (typeof source !== "string" || !source) return;

    if (!isAllowed(source, allowFrom)) return;

    const dataMessage = envelope.dataMessage as Record<string, unknown> | undefined;
    if (!dataMessage) return;

    const rawText = typeof dataMessage.message === "string"
      ? dataMessage.message
      : typeof dataMessage.body === "string"
        ? dataMessage.body
        : undefined;
    if (!rawText) return;

    const text = rawText.length > MAX_MESSAGE_LENGTH
      ? rawText.slice(0, MAX_MESSAGE_LENGTH)
      : rawText;

    const chatType = determineChatType(envelope);
    const chatId = resolveChatId(envelope, source);
    const senderName = typeof envelope.sourceName === "string"
      ? envelope.sourceName
      : undefined;

    const inbound: GatewayInboundMessage = {
      from: source,
      text,
      chatType,
      chatId,
      timestamp: resolveTimestamp(envelope.timestamp ?? dataMessage.timestamp),
      senderName,
    };

    onMessage(inbound).catch((err) => {
      logger?.error(
        `Gateway onMessage handler failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  const tryWebSocket = (): boolean => {
    try {
      const wsUrl = `${apiBase.replace(/^http/, "ws")}/v1/receive/${encodeURIComponent(phoneNumber)}`;
      ws = new WebSocket(wsUrl);

      ws.addEventListener("open", () => {
        reconnectAttempts = 0;
        logger?.info("Signal WebSocket connection established");
      });

      ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(String(event.data)) as Record<string, unknown>;
          const envelope = (data.envelope ?? data) as Record<string, unknown>;
          processEnvelope(envelope);
        } catch (err) {
          logger?.error(
            `Failed to parse Signal WebSocket message: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });

      ws.addEventListener("close", () => {
        if (stopped) return;
        scheduleReconnect();
      });

      ws.addEventListener("error", (err) => {
        logger?.warn(
          `Signal WebSocket error: ${err instanceof Event ? "connection error" : String(err)}`,
        );
      });

      return true;
    } catch {
      return false;
    }
  };

  const startPolling = (): void => {
    const poll = async (): Promise<void> => {
      if (stopped) return;
      try {
        const resp = await fetch(
          `${apiBase}/v1/receive/${encodeURIComponent(phoneNumber)}`,
        );
        if (resp.ok) {
          reconnectAttempts = 0;
          const messages = (await resp.json()) as Array<Record<string, unknown>>;
          for (const msg of messages) {
            try {
              const envelope = (msg.envelope ?? msg) as Record<string, unknown>;
              processEnvelope(envelope);
            } catch (err) {
              logger?.error(
                `Failed to process Signal message: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }
      } catch (err) {
        logger?.warn(
          `Signal poll error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (!stopped) {
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    poll().catch(() => {});
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger?.error(
        `Signal reconnection attempts exhausted (${MAX_RECONNECT_ATTEMPTS}), falling back to polling`,
      );
      startPolling();
      return;
    }

    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    );
    reconnectAttempts++;
    logger?.info(
      `Signal disconnected, reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
    );

    setTimeout(() => {
      if (!stopped) {
        tryWebSocket();
      }
    }, delay);
  };

  // Verify signal-cli REST API is reachable
  try {
    const healthResp = await fetch(`${apiBase}/v1/about`);
    if (!healthResp.ok) {
      throw new Error(`signal-cli API responded with ${healthResp.status}`);
    }
    logger?.info("Signal-cli REST API is reachable");
  } catch (err) {
    throw new Error(
      `Cannot reach signal-cli REST API at ${apiBase}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Prefer WebSocket, fall back to polling
  const wsConnected = tryWebSocket();
  if (!wsConnected) {
    logger?.info("Signal WebSocket unavailable, using HTTP polling");
    startPolling();
  }

  logger?.info(`Signal gateway started for ${phoneNumber}`);

  const sendMessage = async (
    to: string,
    text: string,
  ): Promise<{ ok: boolean; timestamp?: string }> => {
    try {
      const resp = await fetch(`${apiBase}/v2/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          number: phoneNumber,
          recipients: [to],
        }),
      });
      if (!resp.ok) return { ok: false };
      const result = (await resp.json()) as Record<string, unknown>;
      const ts = result.timestamp != null ? String(result.timestamp) : undefined;
      return { ok: true, timestamp: ts };
    } catch {
      return { ok: false };
    }
  };

  const sendMedia = async (
    to: string,
    media: Buffer,
    mimeType: string,
    caption?: string,
  ): Promise<{ ok: boolean; timestamp?: string }> => {
    try {
      const base64Data = media.toString("base64");
      const resp = await fetch(`${apiBase}/v2/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: caption ?? "",
          number: phoneNumber,
          recipients: [to],
          base64_attachments: [`data:${mimeType};base64,${base64Data}`],
        }),
      });
      if (!resp.ok) return { ok: false };
      const result = (await resp.json()) as Record<string, unknown>;
      const ts = result.timestamp != null ? String(result.timestamp) : undefined;
      return { ok: true, timestamp: ts };
    } catch {
      return { ok: false };
    }
  };

  return {
    stop: async () => {
      stopped = true;
      if (pollTimer != null) {
        clearTimeout(pollTimer);
        pollTimer = undefined;
      }
      if (ws) {
        ws.close();
        ws = undefined;
      }
    },
    sendMessage,
    sendMedia,
  };
}
