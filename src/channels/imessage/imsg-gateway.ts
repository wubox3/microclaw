import { execSync } from "node:child_process";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { accessSync, constants } from "node:fs";
import { createLogger } from "../../logging.js";
import { formatError } from "../../infra/errors.js";
import type { EClawConfig } from "../../config/types.js";
import type {
  ImessageGatewayParams,
  ImessageGatewayHandle,
  ImsgChat,
  ImsgMessage,
} from "./types.js";

const log = createLogger("imessage");

const CHANNEL_ID = "imessage";
const MAX_TEXT_LENGTH = 4000;
const POLL_INTERVAL_MS = 3000;
const INITIAL_POLL_DELAY_MS = 500;
const CHAT_REFRESH_MS = 30000;
const HISTORY_LIMIT = 50;
const MAX_CHATS_PER_TICK = 3;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 60000;

// Phone numbers (+1234567890) or email addresses (user@example.com)
const IMESSAGE_HANDLE_PATTERN = /^(\+?[\d\s()-]{7,20}|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/;

function isExecutable(path: string): boolean {
  try {
    accessSync(resolve(path), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveImsgBin(config: EClawConfig): string | null {
  const channelCfg = config.channels?.imessage;
  if (channelCfg?.binPath) {
    const resolved = resolve(channelCfg.binPath);
    if (isExecutable(resolved)) return resolved;
    log.warn(`Configured binPath is not executable: ${resolved}`);
    return null;
  }
  if (process.env.IMSG_PATH) {
    const resolved = resolve(process.env.IMSG_PATH);
    if (isExecutable(resolved)) return resolved;
    log.warn(`IMSG_PATH is not executable: ${resolved}`);
    return null;
  }
  try {
    const found = execSync("which imsg", { encoding: "utf8", timeout: 5000 }).trim();
    return found || null;
  } catch {
    return null;
  }
}

function isAllowed(
  handle: string,
  allowFrom: string[] | undefined,
): boolean {
  if (!allowFrom || allowFrom.length === 0) return true;
  const normalized = handle.replace(/^\+/, "").replace(/[\s-]/g, "");
  return allowFrom.some((entry) => {
    const entryNormalized = entry.replace(/^\+/, "").replace(/[\s-]/g, "");
    return normalized === entryNormalized || handle === entry;
  });
}

async function runImsgCommand(
  binPath: string,
  args: readonly string[],
  timeoutMs = 15000,
): Promise<string | null> {
  return new Promise<string | null>((res) => {
    const child = spawn(binPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        res(stdout);
      } else {
        log.warn(`imsg ${args[0]} failed (exit ${code}): ${stderr.slice(0, 200)}`);
        res(null);
      }
    });

    child.on("error", (err) => {
      log.warn(`imsg ${args[0]} error: ${formatError(err)}`);
      res(null);
    });
  });
}

export function startImsgGateway(
  params: ImessageGatewayParams,
): ImessageGatewayHandle | null {
  const { config, agent, webMonitor, memoryManager } = params;

  if (process.platform !== "darwin") {
    log.info("iMessage is only available on macOS, skipping");
    return null;
  }

  const imsgBin = resolveImsgBin(config);
  if (!imsgBin) {
    log.info("imsg binary not found, skipping (install: brew install steipete/tap/imsg)");
    return null;
  }
  const validBin: string = imsgBin;
  log.info(`Using imsg at ${validBin}`);

  const allowFrom = config.channels?.imessage?.allowFrom;
  const processingChats = new Set<number>();
  const seenMessageGuids = new Set<string>();
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;

  // Cached chat list and refresh timing
  let cachedChats: ReadonlyArray<ImsgChat> = [];
  let lastChatRefresh = 0;
  let chatPollIndex = 0;

  // Track latest message rowid per chat
  const chatLastRowId = new Map<number, number>();

  function broadcastToUi(msg: {
    from: string;
    text: string;
    senderName: string;
    timestamp: number;
    isFromSelf: boolean;
  }): void {
    webMonitor.broadcast(JSON.stringify({
      type: "channel_message",
      channelId: CHANNEL_ID,
      from: msg.from,
      text: msg.text,
      senderName: msg.senderName,
      timestamp: msg.timestamp,
      isFromSelf: msg.isFromSelf,
    }));
  }

  async function sendReply(handle: string, text: string): Promise<boolean> {
    if (!IMESSAGE_HANDLE_PATTERN.test(handle)) {
      log.warn(`Invalid handle format, not sending reply: ${handle.slice(0, 50)}`);
      return false;
    }

    const truncated = text.length > MAX_TEXT_LENGTH
      ? text.slice(0, MAX_TEXT_LENGTH) + "..."
      : text;

    const result = await runImsgCommand(validBin, [
      "send",
      "--to", handle,
      "--text", truncated,
    ], 30000);

    return result !== null;
  }

  async function handleMessage(
    senderHandle: string,
    senderName: string,
    text: string,
    timestamp: number,
    chatId: number,
  ): Promise<void> {
    if (processingChats.has(chatId)) {
      log.info(`Skipping message from chat ${chatId}, still processing previous`);
      return;
    }
    processingChats.add(chatId);

    try {
      const trimmedText = text.length > MAX_TEXT_LENGTH
        ? text.slice(0, MAX_TEXT_LENGTH)
        : text;

      broadcastToUi({
        from: senderHandle,
        text: trimmedText,
        senderName,
        timestamp,
        isFromSelf: true,
      });

      const historyMessages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> = [];
      if (memoryManager) {
        try {
          const history = await memoryManager.loadChatHistory({
            channelId: CHANNEL_ID,
            limit: HISTORY_LIMIT,
          });
          for (const msg of history) {
            historyMessages.push({ role: msg.role, content: msg.content, timestamp: msg.timestamp });
          }
        } catch {
          // History loading is non-fatal
        }
      }

      const response = await agent.chat({
        messages: [
          ...historyMessages,
          { role: "user", content: trimmedText, timestamp },
        ],
        channelId: CHANNEL_ID,
      });

      if (response.text) {
        const sent = await sendReply(senderHandle, response.text);
        if (sent) {
          broadcastToUi({
            from: "assistant",
            text: response.text,
            senderName: "EClaw",
            timestamp: Date.now(),
            isFromSelf: false,
          });
        } else {
          log.warn(`Failed to send reply to ${senderHandle}`);
        }
      }

      if (memoryManager && response.text) {
        memoryManager.saveExchange({
          channelId: CHANNEL_ID,
          userMessage: trimmedText,
          assistantMessage: response.text,
          timestamp,
        }).catch((err) => {
          log.warn(`Failed to persist exchange: ${formatError(err)}`);
        });
      }
    } catch (err) {
      log.error(`Message handling failed: ${formatError(err)}`);
    } finally {
      processingChats.delete(chatId);
    }
  }

  async function refreshChats(): Promise<void> {
    const now = Date.now();
    if (now - lastChatRefresh < CHAT_REFRESH_MS && cachedChats.length > 0) {
      return;
    }

    const output = await runImsgCommand(validBin, [
      "chats", "--limit", "20", "--json",
    ]);
    if (!output) return;

    try {
      const parsed = JSON.parse(output) as ReadonlyArray<ImsgChat>;
      cachedChats = parsed;
      lastChatRefresh = now;

      // Seed rowids for newly discovered chats
      for (const chat of cachedChats) {
        if (!chatLastRowId.has(chat.chat_id)) {
          chatLastRowId.set(chat.chat_id, Number.MAX_SAFE_INTEGER);
        }
      }

      log.debug(`Refreshed chats: ${cachedChats.length} active`);
    } catch {
      log.warn("Failed to parse imsg chats output");
    }
  }

  async function pollMessages(): Promise<void> {
    if (stopped) return;

    try {
      await refreshChats();

      if (cachedChats.length === 0) {
        reconnectAttempts = 0;
        return;
      }

      const chatsToCheck = Math.min(MAX_CHATS_PER_TICK, cachedChats.length);

      for (let i = 0; i < chatsToCheck; i++) {
        if (stopped) break;

        const idx = chatPollIndex % cachedChats.length;
        chatPollIndex += 1;
        const chat = cachedChats[idx];

        const output = await runImsgCommand(validBin, [
          "history",
          "--chat-id", String(chat.chat_id),
          "--limit", "5",
          "--json",
        ]);

        if (!output) continue;

        let messages: ReadonlyArray<ImsgMessage>;
        try {
          messages = JSON.parse(output) as ReadonlyArray<ImsgMessage>;
        } catch {
          continue;
        }

        if (messages.length === 0) continue;

        for (const msg of messages) {
          if (msg.is_from_me) continue;
          if (!msg.text?.trim()) continue;

          // Skip if this is from initial seed (rowid was MAX_SAFE_INTEGER)
          const lastRowId = chatLastRowId.get(chat.chat_id);
          if (lastRowId === Number.MAX_SAFE_INTEGER) {
            // First poll — skip without recording GUID so future polls can re-evaluate
            continue;
          }

          if (seenMessageGuids.has(msg.guid)) continue;
          seenMessageGuids.add(msg.guid);

          if (msg.rowid <= (lastRowId ?? 0)) continue;

          if (!isAllowed(msg.handle_id || chat.handle, allowFrom)) {
            log.info(`Message from ${msg.handle_id || chat.handle} blocked by allowFrom filter`);
            continue;
          }

          const senderHandle = msg.handle_id || chat.handle;
          const senderName = chat.display_name || senderHandle;
          const timestamp = new Date(msg.date).getTime();

          log.info(`New iMessage from ${senderName}: ${msg.text.slice(0, 50)}`);

          handleMessage(senderHandle, senderName, msg.text, timestamp, chat.chat_id).catch(
            (err: unknown) => {
              log.error(`handleMessage error: ${formatError(err)}`);
            },
          );
        }

        // Update latest rowid for this chat
        const maxRowId = Math.max(...messages.map((m) => m.rowid));
        const currentLastRowId = chatLastRowId.get(chat.chat_id) ?? 0;
        if (maxRowId > currentLastRowId || currentLastRowId === Number.MAX_SAFE_INTEGER) {
          chatLastRowId.set(chat.chat_id, maxRowId);
        }
      }

      // Cap seen GUIDs to prevent unbounded growth
      if (seenMessageGuids.size > 1000) {
        const toRemove = [...seenMessageGuids].slice(0, 500);
        for (const id of toRemove) {
          seenMessageGuids.delete(id);
        }
      }

      reconnectAttempts = 0;
    } catch (err) {
      log.warn(`Poll error: ${formatError(err)}`);
      reconnectAttempts += 1;

      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        log.error(`Exceeded ${MAX_RECONNECT_ATTEMPTS} poll failures, stopping`);
        stopped = true;
        return;
      }

      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
        MAX_RECONNECT_DELAY_MS,
      );
      log.info(`Retrying poll in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  const tick = async () => {
    await pollMessages();
    if (!stopped) {
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      pollTimer.unref();
    }
  };

  // Seed chats before starting poll loop to avoid race condition
  refreshChats().then(() => {
    log.info(`Polling started (${POLL_INTERVAL_MS}ms interval, ${cachedChats.length} chats, max ${MAX_CHATS_PER_TICK}/tick)`);
    if (!stopped) {
      pollTimer = setTimeout(tick, INITIAL_POLL_DELAY_MS);
      pollTimer.unref();
    }
  }).catch((err) => {
    log.error(`Initial chat refresh failed: ${formatError(err)}`);
    if (!stopped) {
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      pollTimer.unref();
    }
  });

  log.info("iMessage gateway starting...");

  return {
    stop: () => {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      log.info("iMessage gateway stopped");
    },
  };
}
