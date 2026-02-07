import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GatewayInboundMessage } from "../../../src/channels/plugins/types.js";
import type { NormalizedChatType } from "../../../src/channels/plugins/types.core.js";

const execFileAsync = promisify(execFile);

const MESSAGES_DB = join(homedir(), "Library/Messages/chat.db");
const DEFAULT_POLL_INTERVAL_MS = 3000;
const MAX_MESSAGE_LENGTH = 8000;
const APPLE_EPOCH_OFFSET = 978307200;
const NANOSECOND_THRESHOLD = 1_000_000_000_000;
const MAX_MESSAGES_PER_POLL = 50;
const QUERY_TIMEOUT_MS = 10_000;

export type IMessageGatewayHandle = {
  readonly stop: () => Promise<void>;
};

export type IMessageGatewayParams = {
  allowFrom?: string[];
  onMessage: (msg: GatewayInboundMessage) => Promise<void>;
  pollIntervalMs?: number;
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
};

type RawMessage = {
  rowid: number;
  text: string;
  msg_date: number;
  sender_id: string | null;
  chat_identifier: string | null;
  display_name: string | null;
  group_id: string | null;
};

function buildPollQuery(afterRowId: number): string {
  const safeId = Number.isSafeInteger(afterRowId) ? afterRowId : 0;
  return [
    "SELECT",
    "  m.ROWID as rowid,",
    "  m.text,",
    "  m.date as msg_date,",
    "  h.id as sender_id,",
    "  c.chat_identifier,",
    "  c.display_name,",
    "  c.group_id",
    "FROM message m",
    "LEFT JOIN handle h ON m.handle_id = h.ROWID",
    "LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id",
    "LEFT JOIN chat c ON cmj.chat_id = c.ROWID",
    `WHERE m.ROWID > ${safeId}`,
    "  AND m.is_from_me = 0",
    "  AND m.text IS NOT NULL",
    "  AND m.text != ''",
    "ORDER BY m.ROWID ASC",
    `LIMIT ${MAX_MESSAGES_PER_POLL}`,
  ].join("\n");
}

function appleTimestampToUnixMs(appleDate: number): number {
  if (!appleDate || appleDate <= 0) return Date.now();
  const seconds =
    appleDate > NANOSECOND_THRESHOLD
      ? appleDate / 1_000_000_000
      : appleDate;
  return Math.floor((seconds + APPLE_EPOCH_OFFSET) * 1000);
}

function resolveChatType(groupId: string | null): NormalizedChatType {
  return groupId ? "group" : "direct";
}

function isAllowed(
  senderId: string,
  allowFrom: string[] | undefined,
): boolean {
  if (!allowFrom || allowFrom.length === 0) return true;
  const normalized = senderId.replace(/[\s()-]/g, "");
  const lowerSender = senderId.toLowerCase();
  const lowerNormalized = normalized.toLowerCase();
  return allowFrom.some((entry) => {
    const cleaned = entry.trim().replace(/[\s()-]/g, "");
    if (!cleaned) return false;
    const lowerCleaned = cleaned.toLowerCase();
    return lowerCleaned === lowerSender || lowerCleaned === lowerNormalized;
  });
}

async function queryNewMessages(
  afterRowId: number,
  logger?: IMessageGatewayParams["logger"],
): Promise<RawMessage[]> {
  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      ["-json", MESSAGES_DB, buildPollQuery(afterRowId)],
      { timeout: QUERY_TIMEOUT_MS },
    );
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    return JSON.parse(trimmed) as RawMessage[];
  } catch (err) {
    logger?.warn(
      `Failed to query chat.db: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

async function getMaxRowId(
  logger?: IMessageGatewayParams["logger"],
): Promise<number> {
  const { stdout } = await execFileAsync(
    "sqlite3",
    [MESSAGES_DB, "SELECT MAX(ROWID) FROM message"],
    { timeout: 5_000 },
  );
  const parsed = parseInt(stdout.trim(), 10);
  if (!Number.isFinite(parsed)) {
    logger?.warn("chat.db returned non-numeric max ROWID, defaulting to 0");
    return 0;
  }
  return parsed;
}

export async function startIMessageGateway(
  params: IMessageGatewayParams,
): Promise<IMessageGatewayHandle> {
  const {
    onMessage,
    allowFrom,
    logger,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = params;

  const clampedInterval = Math.max(1000, Math.min(pollIntervalMs, 60_000));

  let stopped = false;
  let lastRowId: number;
  try {
    lastRowId = await getMaxRowId(logger);
  } catch (err) {
    logger?.warn(
      `Failed to read initial ROWID from chat.db (will start from 0): ${err instanceof Error ? err.message : String(err)}`,
    );
    lastRowId = 0;
  }

  logger?.info(`iMessage gateway started, polling from ROWID ${lastRowId}`);

  const poll = async (): Promise<void> => {
    if (stopped) return;

    const messages = await queryNewMessages(lastRowId, logger);
    if (stopped) return;

    for (const msg of messages) {
      lastRowId = Math.max(lastRowId, msg.rowid);

      if (!msg.sender_id || !msg.text) continue;
      if (!isAllowed(msg.sender_id, allowFrom)) continue;

      const text =
        msg.text.length > MAX_MESSAGE_LENGTH
          ? msg.text.slice(0, MAX_MESSAGE_LENGTH)
          : msg.text;

      const inbound: GatewayInboundMessage = {
        from: msg.sender_id,
        text,
        chatType: resolveChatType(msg.group_id),
        chatId: msg.chat_identifier ?? msg.sender_id,
        timestamp: appleTimestampToUnixMs(msg.msg_date),
        senderName: msg.display_name ?? undefined,
      };

      try {
        await onMessage(inbound);
      } catch (err) {
        logger?.error(
          `onMessage handler failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  const intervalId = setInterval(() => {
    poll().catch((err) => {
      if (!stopped) {
        logger?.error(
          `iMessage poll error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }, clampedInterval);

  return {
    stop: async () => {
      stopped = true;
      clearInterval(intervalId);
    },
  };
}
