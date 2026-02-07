import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  type WASocket,
  type WAMessage,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import type { GatewayInboundMessage } from "../../../src/channels/plugins/types.js";

const MAX_MESSAGE_LENGTH = 8000;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export type WhatsAppGatewayHandle = {
  readonly sock: WASocket;
  readonly stop: () => Promise<void>;
};

export type WhatsAppGatewayParams = {
  authDir?: string;
  phoneNumber?: string;
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

/** Minimal pino-compatible silent logger to suppress Baileys noise */
function makeSilentLogger(): unknown {
  const noop = () => {};
  const child = () => makeSilentLogger();
  return { level: "silent", trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child };
}

export async function startWhatsAppGateway(
  params: WhatsAppGatewayParams,
): Promise<WhatsAppGatewayHandle> {
  const { onMessage, allowFrom, phoneNumber, logger } = params;
  const authDir = params.authDir ?? resolve(process.cwd(), ".microclaw", "whatsapp-auth");

  await mkdir(authDir, { recursive: true });

  let stopped = false;
  let currentSock: WASocket;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const connectSocket = async (): Promise<WASocket> => {
    if (stopped) throw new Error("Gateway stopped");

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const usePairingCode = Boolean(phoneNumber) && !state.creds.registered;

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: !usePairingCode,
      logger: makeSilentLogger() as never,
    });

    sock.ev.on("creds.update", saveCreds);

    let pairingCodeRequested = false;

    sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      // Request pairing code when we get a QR (means socket is ready but not authed)
      if (usePairingCode && !pairingCodeRequested && qr) {
        pairingCodeRequested = true;
        // Baileys requires phone number without +, (), -, spaces — digits only with country code
        sock.requestPairingCode(normalizePhone(phoneNumber!))
          .then((code: string) => {
            logger?.info(`\n========================================`);
            logger?.info(`  WhatsApp pairing code: ${code}`);
            logger?.info(`  Enter in WhatsApp > Linked Devices > Link a Device`);
            logger?.info(`========================================\n`);
          })
          .catch((err: unknown) => {
            logger?.error(`Failed to request pairing code: ${err instanceof Error ? err.message : String(err)}`);
          });
      } else if (!usePairingCode && qr) {
        logger?.info("WhatsApp QR code displayed in terminal — scan to authenticate");
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })
          ?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          logger?.warn("WhatsApp logged out — will not reconnect");
          return;
        }

        if (!stopped && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delay = Math.min(
            BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
            MAX_RECONNECT_DELAY_MS,
          );
          logger?.info(`WhatsApp disconnected (status: ${statusCode}), reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined;
            if (!stopped) {
              connectSocket().then((newSock) => {
                const oldSock = currentSock;
                currentSock = newSock;
                try {
                  oldSock.end(undefined);
                } catch {
                  // old socket may already be closed
                }
              }).catch((err) => {
                logger?.error(`Reconnect failed: ${err instanceof Error ? err.message : String(err)}`);
              });
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

    sock.ev.on("messages.upsert", ({ messages }: { messages: WAMessage[] }) => {
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;
        try {
          processMessage(msg);
        } catch (err) {
          logger?.error(`Failed to process WhatsApp message: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });

    return sock;
  };

  const processMessage = (msg: WAMessage): void => {
    const key = msg.key;
    if (!key) return;

    const remoteJid = key.remoteJid;
    if (!remoteJid) return;

    // Apply allowFrom filter
    const senderJid = key.participant ?? remoteJid;
    if (!isAllowed(senderJid, allowFrom)) return;

    // Extract text content
    const message = msg.message;
    if (!message) return;

    const rawText = extractText(message);
    if (!rawText) return;

    const text = rawText.length > MAX_MESSAGE_LENGTH
      ? rawText.slice(0, MAX_MESSAGE_LENGTH)
      : rawText;

    const isGroup = remoteJid.endsWith("@g.us");
    const chatType = isGroup ? "group" : "direct";
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

  currentSock = await connectSocket();

  const handle: WhatsAppGatewayHandle = {
    get sock() {
      return currentSock;
    },
    stop: async () => {
      stopped = true;
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          resolve();
        }, 2000);
        currentSock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
          if (update.connection === "close") {
            clearTimeout(timeout);
            resolve();
          }
        });
        currentSock.end(undefined);
      });
    },
  };

  return handle;
}

function extractText(message: Record<string, unknown>): string | undefined {
  if (typeof message.conversation === "string") {
    return message.conversation;
  }

  const extText = message.extendedTextMessage as Record<string, unknown> | undefined;
  if (extText && typeof extText.text === "string") {
    return extText.text;
  }

  for (const key of ["imageMessage", "videoMessage", "documentMessage"]) {
    const media = message[key] as Record<string, unknown> | undefined;
    if (media && typeof media.caption === "string") {
      return media.caption;
    }
  }

  return undefined;
}
