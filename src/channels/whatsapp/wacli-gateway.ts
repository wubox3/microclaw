import { spawn, execSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import type { ChildProcess } from "node:child_process";
import { createLogger } from "../../logging.js";
import { formatError } from "../../infra/errors.js";
import type { EClawConfig } from "../../config/types.js";
import type {
  WhatsAppGatewayParams,
  WhatsAppGatewayHandle,
  ParsedMessage,
} from "./types.js";

const log = createLogger("whatsapp-wacli");

const CHANNEL_ID = "whatsapp";
const MAX_TEXT_LENGTH = 4000;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30000;
const HISTORY_LIMIT = 50;
const POLL_INTERVAL_MS = 3000;

// WhatsApp JID: digits@s.whatsapp.net (DM), digits-digits@g.us (group), or digits@lid
const JID_PATTERN = /^[\d]+([-][\d]+)?@(s\.whatsapp\.net|g\.us|lid)$/;

// -- wacli messages list response shape ------------------------------------

interface WacliMessage {
  readonly ChatJID: string;
  readonly ChatName: string;
  readonly MsgID: string;
  readonly SenderJID: string;
  readonly Timestamp: string;
  readonly FromMe: boolean;
  readonly Text: string;
  readonly DisplayText: string;
}

interface WacliListResponse {
  readonly success: boolean;
  readonly data: { readonly messages: readonly WacliMessage[] | null } | null;
  readonly error: string | null;
}

// -- Helpers ----------------------------------------------------------------

function isExecutable(path: string): boolean {
  try {
    accessSync(resolve(path), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveWacliBin(config: EClawConfig): string | null {
  const channelCfg = config.channels?.whatsapp;
  if (channelCfg?.binPath) {
    const resolved = resolve(channelCfg.binPath);
    if (isExecutable(resolved)) return resolved;
    log.warn(`Configured binPath is not executable: ${resolved}`);
    return null;
  }
  if (process.env.WACLI_PATH) {
    const resolved = resolve(process.env.WACLI_PATH);
    if (isExecutable(resolved)) return resolved;
    log.warn(`WACLI_PATH is not executable: ${resolved}`);
    return null;
  }
  try {
    const found = execSync("which wacli", { encoding: "utf8", timeout: 5000 }).trim();
    return found || null;
  } catch {
    return null;
  }
}

function isAllowed(jid: string, allowFrom: string[] | undefined): boolean {
  if (!allowFrom || allowFrom.length === 0) {
    return true;
  }
  const phone = jid.replace(/@(s\.whatsapp\.net|lid)$/, "").replace(/^\+/, "");
  return allowFrom.some((entry) => {
    const normalized = entry.replace(/^\+/, "").replace(/[\s-]/g, "");
    return phone === normalized || jid === entry;
  });
}

function wacliMessageToParsed(msg: WacliMessage): ParsedMessage | null {
  const text = msg.Text || msg.DisplayText;
  if (!text) return null;

  const timestamp = new Date(msg.Timestamp).getTime();
  if (Number.isNaN(timestamp)) return null;

  return {
    from: msg.SenderJID,
    text: text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text,
    chatId: msg.ChatJID,
    senderName: msg.ChatName || msg.SenderJID,
    timestamp,
  };
}

async function runWacliCommand(
  binPath: string,
  args: readonly string[],
  timeoutMs: number = 15000,
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
        log.warn(`wacli ${args[0]} failed (exit ${code}): ${stderr.slice(0, 200)}`);
        res(null);
      }
    });

    child.on("error", (err) => {
      log.warn(`wacli ${args[0]} error: ${formatError(err)}`);
      res(null);
    });
  });
}

// -- Main Gateway -----------------------------------------------------------

export function startWacliGateway(
  params: WhatsAppGatewayParams,
): WhatsAppGatewayHandle | null {
  const { config, agent, webMonitor, memoryManager } = params;

  const resolved = resolveWacliBin(config);
  if (!resolved) {
    log.info("wacli binary not found, skipping");
    return null;
  }
  const wacliBin: string = resolved;
  log.info(`Using wacli at ${wacliBin}`);

  const allowFrom = config.channels?.whatsapp?.allowFrom;
  const processingChats = new Set<string>();
  const seenMessageIds = new Set<string>();
  let activeChild: ChildProcess | null = null;
  let stopped = false;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPollTime: string = new Date().toISOString();

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

  // -- Sync lifecycle (stop/start for lock management) ----------------------

  function killSync(): Promise<void> {
    return new Promise<void>((res) => {
      if (!activeChild) {
        res();
        return;
      }
      const child = activeChild;
      activeChild = null;

      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        res();
      }, 3000);

      child.once("close", () => {
        clearTimeout(timeout);
        res();
      });

      child.kill("SIGTERM");
    });
  }

  async function sendWacliText(to: string, message: string): Promise<boolean> {
    const truncated = message.length > MAX_TEXT_LENGTH
      ? message.slice(0, MAX_TEXT_LENGTH) + "..."
      : message;

    // Stop sync to release the store lock, send, then restart
    await killSync();

    const result = await runWacliCommand(wacliBin, [
      "send", "text",
      "--to", to,
      "--message", truncated,
      "--json",
    ], 30000);

    // Restart sync after send
    launchSync();

    return result !== null;
  }

  // -- Message handling -----------------------------------------------------

  async function handleMessage(parsed: ParsedMessage): Promise<void> {
    const { from, text, chatId, senderName, timestamp } = parsed;

    if (!isAllowed(from, allowFrom)) {
      log.info(`Message from ${from} blocked by allowFrom filter`);
      return;
    }

    if (processingChats.has(chatId)) {
      log.info(`Skipping message from ${chatId}, still processing previous`);
      return;
    }
    processingChats.add(chatId);

    try {
      // User's WhatsApp message: isFromSelf=true so it shows on RIGHT in web UI
      broadcastToUi({ from, text, senderName, timestamp, isFromSelf: true });

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
          { role: "user", content: text, timestamp },
        ],
        channelId: CHANNEL_ID,
      });

      if (response.text && JID_PATTERN.test(chatId)) {
        const sent = await sendWacliText(chatId, response.text);
        if (sent) {
          // EClaw reply: from='assistant' so it shows on LEFT in web UI
          broadcastToUi({
            from: "assistant",
            text: response.text,
            senderName: "EClaw",
            timestamp: Date.now(),
            isFromSelf: false,
          });
        } else {
          log.warn(`Failed to send reply to ${chatId}`);
        }
      } else if (response.text) {
        log.warn(`Invalid chatId format, not sending reply: ${chatId.slice(0, 50)}`);
      }

      if (memoryManager && response.text) {
        memoryManager.saveExchange({
          channelId: CHANNEL_ID,
          userMessage: text,
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

  // -- Polling for new messages ---------------------------------------------

  async function pollMessages(): Promise<void> {
    if (stopped) return;

    try {
      const output = await runWacliCommand(wacliBin, [
        "messages", "list",
        "--after", lastPollTime,
        "--limit", "20",
        "--json",
      ]);

      if (!output) return;

      let response: WacliListResponse;
      try {
        response = JSON.parse(output) as WacliListResponse;
      } catch {
        return;
      }

      if (!response.success || !response.data?.messages) return;

      const messages = response.data.messages;
      let latestTimestamp = lastPollTime;

      for (const msg of messages) {
        if (seenMessageIds.has(msg.MsgID)) continue;
        seenMessageIds.add(msg.MsgID);

        if (msg.FromMe) continue;

        if (msg.Timestamp > latestTimestamp) {
          latestTimestamp = msg.Timestamp;
        }

        const parsed = wacliMessageToParsed(msg);
        if (parsed) {
          log.info(`New WhatsApp message from ${msg.ChatName}: ${parsed.text.slice(0, 50)}`);
          handleMessage(parsed).catch((err: unknown) => {
            log.error(`handleMessage error: ${formatError(err)}`);
          });
        }
      }

      if (latestTimestamp > lastPollTime) {
        lastPollTime = latestTimestamp;
      }

      // Cap seen IDs set to prevent unbounded growth
      if (seenMessageIds.size > 1000) {
        const toRemove = [...seenMessageIds].slice(0, 500);
        for (const id of toRemove) {
          seenMessageIds.delete(id);
        }
      }
    } catch (err) {
      log.warn(`Poll error: ${formatError(err)}`);
    }
  }

  function startPolling(): void {
    if (stopped) return;

    const tick = async () => {
      await pollMessages();
      if (!stopped) {
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
        pollTimer.unref();
      }
    };

    pollTimer = setTimeout(tick, 2000);
    pollTimer.unref();
    log.info(`Message polling started (${POLL_INTERVAL_MS}ms interval)`);
  }

  // -- Sync process (keeps WhatsApp connection alive) -----------------------

  function launchSync(): void {
    if (stopped) return;

    if (stabilityTimer) {
      clearTimeout(stabilityTimer);
      stabilityTimer = null;
    }

    const child = spawn(wacliBin, ["sync", "--follow", "--json"], {
      stdio: ["ignore", "pipe", "pipe"] as const,
    });
    activeChild = child;

    // Drain stdout to prevent buffer backpressure
    child.stdout.resume();

    child.stderr.on("data", (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) {
        log.warn(`wacli stderr: ${msg.slice(0, 300)}`);
      }
    });

    let reconnectScheduled = false;

    child.on("close", (code: number | null) => {
      if (child === activeChild) {
        activeChild = null;
      }
      if (stopped || reconnectScheduled) return;
      reconnectScheduled = true;

      log.warn(`wacli sync exited with code ${code}`);
      scheduleReconnect();
    });

    child.on("error", (err: Error) => {
      if (child === activeChild) {
        activeChild = null;
      }
      if (stopped || reconnectScheduled) return;
      reconnectScheduled = true;

      log.error(`wacli sync spawn error: ${formatError(err)}`);
      scheduleReconnect();
    });

    stabilityTimer = setTimeout(() => {
      stabilityTimer = null;
      reconnectAttempts = 0;
    }, 5000);
    stabilityTimer.unref();
  }

  function scheduleReconnect(): void {
    if (stopped) return;

    reconnectAttempts += 1;
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      log.error(`Exceeded ${MAX_RECONNECT_ATTEMPTS} reconnect attempts, giving up`);
      return;
    }

    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS,
    );
    log.info(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      launchSync();
    }, delay);
    reconnectTimer.unref();
  }

  launchSync();
  startPolling();
  log.info("wacli gateway started");

  return {
    stop: () => {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (stabilityTimer) {
        clearTimeout(stabilityTimer);
        stabilityTimer = null;
      }
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (activeChild) {
        activeChild.kill("SIGTERM");
        activeChild = null;
      }
      log.info("wacli gateway stopped");
    },
  };
}
