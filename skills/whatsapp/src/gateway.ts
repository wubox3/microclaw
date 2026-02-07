import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  type WASocket,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import type { GatewayInboundMessage } from "../../../src/channels/plugins/types.js";

const MAX_MESSAGE_LENGTH = 8000;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 60_000;

export type WhatsAppGatewayHandle = {
  readonly sock: WASocket;
  readonly stop: () => Promise<void>;
};

export type WhatsAppGatewayParams = {
  authDir?: string;
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

function isAllowed(jid: string, allowFrom: string[] | undefined): boolean {
  if (!allowFrom || allowFrom.length === 0) return true;
  const normalized = jidNormalizedUser(jid);
  const phone = normalized.split("@")[0];
  return allowFrom.some((entry) => normalizePhone(entry) === phone);
}

function resolveTimestamp(ts: unknown): number {
  if (typeof ts === "number") return ts * 1000;
  if (typeof ts === "bigint") return Number(ts) * 1000;
  if (typeof ts === "object" && ts !== null && "toNumber" in ts) {
    return (ts as { toNumber: () => number }).toNumber() * 1000;
  }
  return Date.now();
}

export async function startWhatsAppGateway(
  params: WhatsAppGatewayParams,
): Promise<WhatsAppGatewayHandle> {
  const { onMessage, allowFrom, logger } = params;
  const authDir = params.authDir ?? resolve(process.cwd(), ".microclaw", "whatsapp-auth");

  await mkdir(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  let stopped = false;
  let currentSock: WASocket;
  let reconnectAttempts = 0;

  const connectSocket = (): WASocket => {
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "close") {
        const boom = lastDisconnect?.error as Boom | undefined;
        const statusCode = boom?.output?.statusCode ?? 0;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        if (isLoggedOut) {
          logger?.warn("WhatsApp logged out — will not reconnect");
          return;
        }

        if (!stopped && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(
            BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
            MAX_RECONNECT_DELAY_MS,
          );
          reconnectAttempts++;
          logger?.info(`WhatsApp disconnected, reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          setTimeout(() => {
            if (!stopped) {
              currentSock = connectSocket();
            }
          }, delay);
        } else if (!stopped) {
          logger?.error(`WhatsApp reconnection attempts exhausted (${MAX_RECONNECT_ATTEMPTS})`);
        }
      }

      if (connection === "open") {
        reconnectAttempts = 0;
        logger?.info("WhatsApp connection established");
      }
    });

    sock.ev.on(
      "messages.upsert" as keyof BaileysEventMap,
      (upsert: { messages: Array<Record<string, unknown>>; type: string }) => {
        if (upsert.type !== "notify") return;

        for (const msg of upsert.messages) {
          try {
            processMessage(msg);
          } catch (err) {
            logger?.error(`Failed to process WhatsApp message: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      },
    );

    return sock;
  };

  const processMessage = (msg: Record<string, unknown>): void => {
    const key = msg.key as { fromMe?: boolean; remoteJid?: string; participant?: string } | undefined;
    if (!key) return;

    // Skip messages sent by ourselves
    if (key.fromMe) return;

    const remoteJid = key.remoteJid;
    if (!remoteJid) return;

    // Apply allowFrom filter
    const senderJid = key.participant ?? remoteJid;
    if (!isAllowed(senderJid, allowFrom)) return;

    // Extract text content
    const message = msg.message as Record<string, unknown> | undefined;
    if (!message) return;

    const rawText = extractText(message);
    if (!rawText) return;

    // Truncate oversized messages to prevent abuse
    const text = rawText.length > MAX_MESSAGE_LENGTH
      ? rawText.slice(0, MAX_MESSAGE_LENGTH)
      : rawText;

    // Determine chat type
    const isGroup = remoteJid.endsWith("@g.us");
    const chatType = isGroup ? "group" : "direct";

    // Build sender name
    const pushName = typeof msg.pushName === "string" ? msg.pushName : undefined;

    const inbound: GatewayInboundMessage = {
      from: senderJid,
      text,
      chatType,
      chatId: remoteJid,
      timestamp: resolveTimestamp(msg.messageTimestamp),
      senderName: pushName,
    };

    onMessage(inbound).catch((err) => {
      logger?.error(`Gateway onMessage handler failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  currentSock = connectSocket();

  const handle: WhatsAppGatewayHandle = {
    get sock() {
      return currentSock;
    },
    stop: async () => {
      stopped = true;
      currentSock.end(undefined);
    },
  };

  return handle;
}

function extractText(message: Record<string, unknown>): string | undefined {
  // Plain text
  if (typeof message.conversation === "string") {
    return message.conversation;
  }

  // Extended text (replies, links)
  const extText = message.extendedTextMessage as Record<string, unknown> | undefined;
  if (extText && typeof extText.text === "string") {
    return extText.text;
  }

  // Image/video/document with caption
  for (const key of ["imageMessage", "videoMessage", "documentMessage"]) {
    const media = message[key] as Record<string, unknown> | undefined;
    if (media && typeof media.caption === "string") {
      return media.caption;
    }
  }

  return undefined;
}
