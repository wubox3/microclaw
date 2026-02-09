import { spawn, execSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "../../logging.js";
import { formatError } from "../../infra/errors.js";
import type {
  SignalGatewayParams,
  SignalGatewayHandle,
  SignalJsonMessage,
} from "./types.js";

const log = createLogger("signal");

const CHANNEL_ID = "signal";
const MAX_TEXT_LENGTH = 4000;
const POLL_INTERVAL_MS = 3000;
const HISTORY_LIMIT = 50;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 60000;

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

function resolvePhoneNumber(params: SignalGatewayParams): string | null {
  const fromEnv = process.env.SIGNAL_PHONE_NUMBER?.trim();
  if (fromEnv && E164_PATTERN.test(fromEnv)) return fromEnv;

  const fromConfig = params.config.channels?.signal?.accountId?.trim();
  if (fromConfig && E164_PATTERN.test(fromConfig)) return fromConfig;

  return null;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(resolve(path), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveSignalCliBin(): string | null {
  if (process.env.SIGNAL_CLI_PATH) {
    const resolved = resolve(process.env.SIGNAL_CLI_PATH);
    if (isExecutable(resolved)) return resolved;
    log.warn(`SIGNAL_CLI_PATH is not executable: ${resolved}`);
    return null;
  }
  try {
    const found = execSync("which signal-cli", { encoding: "utf8", timeout: 5000 }).trim();
    return found || null;
  } catch {
    return null;
  }
}

function isAllowed(source: string, allowFrom: string[] | undefined): boolean {
  if (!allowFrom || allowFrom.length === 0) return true;

  return allowFrom.some((entry) => {
    const normalized = entry.trim();
    return source === normalized;
  });
}

function runSignalCli(
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
        log.warn(`signal-cli ${args.slice(0, 3).join(" ")} failed (exit ${code}): ${stderr.slice(0, 200)}`);
        res(null);
      }
    });

    child.on("error", (err) => {
      log.warn(`signal-cli spawn error: ${formatError(err)}`);
      res(null);
    });
  });
}

export function startSignalPollingGateway(
  params: SignalGatewayParams,
): SignalGatewayHandle | null {
  const { config, agent, webMonitor, memoryManager } = params;

  const phoneNumber = resolvePhoneNumber(params);
  if (!phoneNumber) {
    log.info("No Signal phone number found, skipping");
    return null;
  }

  const binPath = resolveSignalCliBin();
  if (!binPath) {
    log.info("signal-cli binary not found, skipping");
    return null;
  }
  log.info(`Using signal-cli at ${binPath}`);

  const allowFrom = config.channels?.signal?.allowFrom;
  const processingChats = new Set<string>();
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;

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

  async function sendReply(recipient: string, text: string): Promise<boolean> {
    const truncated = text.length > MAX_TEXT_LENGTH
      ? text.slice(0, MAX_TEXT_LENGTH) + "..."
      : text;

    const result = await runSignalCli(binPath!, [
      "-a", phoneNumber!,
      "send",
      "-m", truncated,
      recipient,
    ], 30000);

    return result !== null;
  }

  async function handleMessage(
    source: string,
    sourceName: string,
    text: string,
    timestamp: number,
    replyTo: string,
  ): Promise<void> {
    if (!isAllowed(source, allowFrom)) {
      log.info(`Message from ${source} blocked by allowFrom filter`);
      return;
    }

    const chatId = replyTo;
    if (processingChats.has(chatId)) {
      log.info(`Skipping message from ${chatId}, still processing previous`);
      return;
    }
    processingChats.add(chatId);

    const trimmedText = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;

    try {
      broadcastToUi({ from: source, text: trimmedText, senderName: sourceName, timestamp, isFromSelf: true });

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
        const sent = await sendReply(replyTo, response.text);
        if (sent) {
          broadcastToUi({
            from: "assistant",
            text: response.text,
            senderName: "EClaw",
            timestamp: Date.now(),
            isFromSelf: false,
          });
        } else {
          log.warn(`Failed to send reply to ${replyTo}`);
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

  function parseJsonMessages(output: string): SignalJsonMessage[] {
    const messages: SignalJsonMessage[] = [];
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{")) continue;
      try {
        messages.push(JSON.parse(trimmed) as SignalJsonMessage);
      } catch {
        // skip malformed lines
      }
    }
    return messages;
  }

  function processMessage(msg: SignalJsonMessage): void {
    const env = msg.envelope;
    if (!env) return;

    const dataMsg = env.dataMessage;
    if (!dataMsg?.message) return;

    const source = env.sourceNumber ?? env.source;
    if (!source) return;

    // Skip messages from self
    if (source === phoneNumber) return;

    const sourceName = env.sourceName ?? source;
    const timestamp = dataMsg.timestamp ?? env.timestamp ?? Date.now();
    const groupId = dataMsg.groupInfo?.groupId;
    const replyTo = groupId ?? source;

    log.info(`New Signal message from ${sourceName}: ${dataMsg.message.slice(0, 50)}`);

    handleMessage(source, sourceName, dataMsg.message, timestamp, replyTo).catch((err: unknown) => {
      log.error(`handleMessage error: ${formatError(err)}`);
    });
  }

  async function pollMessages(): Promise<void> {
    if (stopped) return;

    try {
      const output = await runSignalCli(binPath!, [
        "-a", phoneNumber!,
        "-o", "json",
        "receive",
        "-t", "1",
      ], 30000);

      if (!output) {
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
        log.info(`Retrying in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return;
      }

      reconnectAttempts = 0;
      const messages = parseJsonMessages(output);

      for (const msg of messages) {
        processMessage(msg);
      }
    } catch (err) {
      log.warn(`Poll error: ${formatError(err)}`);
    }
  }

  async function startPolling(): Promise<void> {
    // Verify signal-cli works with this account
    const versionOutput = await runSignalCli(binPath!, ["--version"]);
    if (!versionOutput) {
      log.error("signal-cli version check failed, gateway not started");
      return;
    }
    log.info(`signal-cli ${versionOutput.trim()}`);
    log.info(`Polling started for ${phoneNumber} (${POLL_INTERVAL_MS}ms interval)`);

    const tick = async () => {
      await pollMessages();
      if (!stopped) {
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
        pollTimer.unref();
      }
    };

    pollTimer = setTimeout(tick, 500);
    pollTimer.unref();
  }

  startPolling().catch((err) => {
    log.error(`Signal gateway startup failed: ${formatError(err)}`);
  });

  log.info("Signal gateway starting...");

  return {
    stop: () => {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      log.info("Signal gateway stopped");
    },
  };
}
