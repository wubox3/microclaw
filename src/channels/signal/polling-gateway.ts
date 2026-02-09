import { createLogger } from "../../logging.js";
import { formatError } from "../../infra/errors.js";
import type {
  SignalGatewayParams,
  SignalGatewayHandle,
  SignalEnvelope,
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

function resolveBaseUrl(): string {
  const fromEnv = process.env.SIGNAL_CLI_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return "http://localhost:8080";
}

function isAllowed(source: string, allowFrom: string[] | undefined): boolean {
  if (!allowFrom || allowFrom.length === 0) return true;

  return allowFrom.some((entry) => {
    const normalized = entry.trim();
    return source === normalized;
  });
}

async function signalApi<T>(
  baseUrl: string,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T | null> {
  const url = `${baseUrl}${path}`;
  try {
    const options: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      log.warn(`Signal API ${method} ${path} returned ${response.status}`);
      return null;
    }
    const data = (await response.json()) as T;
    return data;
  } catch (err) {
    log.warn(`Signal API ${method} ${path} error: ${formatError(err)}`);
    return null;
  }
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

  const baseUrl = resolveBaseUrl();
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

    const result = await signalApi(baseUrl, "POST", "/v2/send", {
      message: truncated,
      number: phoneNumber,
      recipients: [recipient],
    });

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

  function processEnvelope(envelope: SignalEnvelope): void {
    const env = envelope.envelope;
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
      const encoded = encodeURIComponent(phoneNumber!);
      const envelopes = await signalApi<SignalEnvelope[]>(
        baseUrl,
        "GET",
        `/v1/receive/${encoded}`,
      );

      if (!envelopes || envelopes.length === 0) {
        reconnectAttempts = 0;
        return;
      }

      reconnectAttempts = 0;

      for (const envelope of envelopes) {
        processEnvelope(envelope);
      }
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

  async function startPolling(): Promise<void> {
    // Verify API is reachable
    const about = await signalApi<{ versions?: string[] }>(baseUrl, "GET", "/v1/about");
    if (!about) {
      log.warn(`signal-cli REST API not reachable at ${baseUrl}, gateway will retry on poll`);
    } else {
      log.info(`signal-cli REST API connected at ${baseUrl}`);
    }

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
