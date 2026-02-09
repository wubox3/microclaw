import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import { createLogger } from "../../logging.js";
import { formatError } from "../../infra/errors.js";
import type {
  GoogleChatGatewayParams,
  GoogleChatGatewayHandle,
  GoogleChatEvent,
  ServiceAccountCredentials,
} from "./types.js";

const log = createLogger("googlechat");

const CHANNEL_ID = "googlechat";
const MAX_TEXT_LENGTH = 4096;
const HISTORY_LIMIT = 50;
const MAX_REQUEST_BODY_SIZE = 1_048_576;
const TOKEN_REFRESH_MARGIN_MS = 300_000;
const SPACE_ID_PATTERN = /^spaces\/[a-zA-Z0-9_-]+$/;
const THREAD_NAME_PATTERN = /^spaces\/[a-zA-Z0-9_-]+\/threads\/[a-zA-Z0-9_-]+$/;

function resolveCredentials(
  params: GoogleChatGatewayParams,
): ServiceAccountCredentials | null {
  const credPath =
    process.env.GOOGLE_CHAT_CREDENTIALS?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
    params.config.channels?.googlechat?.binPath?.trim();

  if (!credPath) return null;

  try {
    const raw = fs.readFileSync(credPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clientEmail = parsed.client_email;
    const privateKey = parsed.private_key;
    const tokenUri = parsed.token_uri;

    if (
      typeof clientEmail !== "string" ||
      typeof privateKey !== "string" ||
      typeof tokenUri !== "string"
    ) {
      log.warn("Service account JSON missing required fields");
      return null;
    }

    return {
      client_email: clientEmail,
      private_key: privateKey,
      token_uri: tokenUri,
    };
  } catch (err) {
    log.warn(`Failed to read service account credentials: ${formatError(err)}`);
    return null;
  }
}

function resolveVerificationToken(
  params: GoogleChatGatewayParams,
): string | null {
  const fromEnv = process.env.GOOGLE_CHAT_VERIFICATION_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const fromConfig = params.config.channels?.googlechat?.token?.trim();
  if (fromConfig) return fromConfig;

  return null;
}

function resolvePort(): number {
  const fromEnv = process.env.GOOGLE_CHAT_WEBHOOK_PORT?.trim();
  if (fromEnv) {
    const parsed = parseInt(fromEnv, 10);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) return parsed;
  }
  return 8765;
}

function resolveHost(): string {
  const fromEnv = process.env.GOOGLE_CHAT_WEBHOOK_HOST?.trim();
  if (fromEnv) return fromEnv;
  return "0.0.0.0";
}

function base64UrlEncode(data: Buffer): string {
  return data
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function createJwt(
  credentials: ServiceAccountCredentials,
  nowSeconds: number,
): string {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/chat.bot",
    aud: credentials.token_uri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };

  const headerB64 = base64UrlEncode(
    Buffer.from(JSON.stringify(header), "utf-8"),
  );
  const payloadB64 = base64UrlEncode(
    Buffer.from(JSON.stringify(payload), "utf-8"),
  );
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto.sign(
    "SHA256",
    Buffer.from(signingInput, "utf-8"),
    credentials.private_key,
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function verifyToken(
  authHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (!authHeader) return false;

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return false;

  const received = parts[1];
  if (received.length !== expectedToken.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(received, "utf-8"),
    Buffer.from(expectedToken, "utf-8"),
  );
}

export function startGoogleChatWebhookGateway(
  params: GoogleChatGatewayParams,
): GoogleChatGatewayHandle | null {
  const { config, agent, webMonitor, memoryManager } = params;

  const resolvedCredentials = resolveCredentials(params);
  if (!resolvedCredentials) {
    log.info("No Google Chat credentials found, skipping");
    return null;
  }

  const resolvedToken = resolveVerificationToken(params);
  if (!resolvedToken) {
    log.info("No Google Chat verification token found, skipping");
    return null;
  }

  const creds = resolvedCredentials;
  const webhookToken = resolvedToken;
  const allowFrom = config.channels?.googlechat?.allowFrom;
  const port = resolvePort();
  const webhookHost = resolveHost();
  const processingSpaces = new Set<string>();

  let cachedAccessToken: string | null = null;
  let tokenExpiresAt = 0;

  async function getAccessToken(): Promise<string> {
    const now = Date.now();
    if (cachedAccessToken && now < tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return cachedAccessToken;
    }

    const nowSeconds = Math.floor(now / 1000);
    const jwt = createJwt(creds, nowSeconds);

    const response = await fetch(creds.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    cachedAccessToken = data.access_token;
    tokenExpiresAt = now + data.expires_in * 1000;

    log.info("Google Chat access token refreshed");
    return cachedAccessToken;
  }

  function broadcastToUi(msg: {
    from: string;
    text: string;
    senderName: string;
    timestamp: number;
    isFromSelf: boolean;
  }): void {
    webMonitor.broadcast(
      JSON.stringify({
        type: "channel_message",
        channelId: CHANNEL_ID,
        from: msg.from,
        text: msg.text,
        senderName: msg.senderName,
        timestamp: msg.timestamp,
        isFromSelf: msg.isFromSelf,
      }),
    );
  }

  async function sendReply(
    spaceName: string,
    text: string,
    threadName?: string,
  ): Promise<boolean> {
    const truncated =
      text.length > MAX_TEXT_LENGTH
        ? text.slice(0, MAX_TEXT_LENGTH) + "..."
        : text;

    try {
      const accessToken = await getAccessToken();
      const url = `https://chat.googleapis.com/v1/${spaceName}/messages`;
      const body: Record<string, unknown> = { text: truncated };
      if (threadName) {
        body.thread = { name: threadName };
        body.messageReplyOption = "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD";
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        log.warn(
          `Google Chat API send failed (${response.status}): ${errText}`,
        );
        return false;
      }

      return true;
    } catch (err) {
      log.warn(`Failed to send Google Chat reply: ${formatError(err)}`);
      return false;
    }
  }

  function isAllowed(
    senderEmail: string | undefined,
    senderName: string,
    allowList: string[] | undefined,
  ): boolean {
    if (!allowList || allowList.length === 0) return true;

    return allowList.some((entry) => {
      const normalized = entry.trim();
      return (
        (senderEmail && senderEmail === normalized) ||
        senderName === normalized
      );
    });
  }

  async function handleMessage(
    senderEmail: string | undefined,
    senderName: string,
    text: string,
    timestamp: number,
    spaceName: string,
    threadName?: string,
  ): Promise<void> {
    if (processingSpaces.has(spaceName)) {
      log.info(
        `Skipping message from ${spaceName}, still processing previous`,
      );
      return;
    }
    processingSpaces.add(spaceName);

    const trimmedText =
      text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;

    try {
      broadcastToUi({
        from: senderEmail ?? senderName,
        text: trimmedText,
        senderName,
        timestamp,
        isFromSelf: true,
      });

      const historyMessages: Array<{
        role: "user" | "assistant";
        content: string;
        timestamp: number;
      }> = [];
      if (memoryManager) {
        try {
          const history = await memoryManager.loadChatHistory({
            channelId: CHANNEL_ID,
            limit: HISTORY_LIMIT,
          });
          for (const msg of history) {
            historyMessages.push({
              role: msg.role,
              content: msg.content,
              timestamp: msg.timestamp,
            });
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
        const sent = await sendReply(spaceName, response.text, threadName);
        if (sent) {
          broadcastToUi({
            from: "assistant",
            text: response.text,
            senderName: "EClaw",
            timestamp: Date.now(),
            isFromSelf: false,
          });
        } else {
          log.warn(`Failed to send reply to ${spaceName}`);
        }
      }

      if (memoryManager && response.text) {
        memoryManager
          .saveExchange({
            channelId: CHANNEL_ID,
            userMessage: trimmedText,
            assistantMessage: response.text,
            timestamp,
          })
          .catch((err) => {
            log.warn(`Failed to persist exchange: ${formatError(err)}`);
          });
      }
    } catch (err) {
      log.error(`Message handling failed: ${formatError(err)}`);
    } finally {
      processingSpaces.delete(spaceName);
    }
  }

  function processEvent(event: GoogleChatEvent): void {
    if (event.type !== "MESSAGE") return;

    const message = event.message;
    if (!message) return;

    const sender = message.sender;
    if (!sender) return;

    // Skip bot messages
    if (sender.type === "BOT") return;

    const text = message.argumentText?.trim() || message.text?.trim();
    if (!text) return;

    const spaceName = message.space?.name;
    if (!spaceName || !SPACE_ID_PATTERN.test(spaceName)) {
      log.warn(`Invalid space name: ${spaceName}`);
      return;
    }

    const senderEmail = sender.email;
    const senderName = sender.displayName || sender.name;

    if (!isAllowed(senderEmail, sender.name, allowFrom)) {
      log.info(
        `Message from ${senderEmail ?? sender.name} blocked by allowFrom filter`,
      );
      return;
    }

    const parsedTime = message.createTime
      ? new Date(message.createTime).getTime()
      : NaN;
    const timestamp = Number.isNaN(parsedTime) ? Date.now() : parsedTime;
    const rawThreadName = message.thread?.name;
    const threadName =
      rawThreadName && THREAD_NAME_PATTERN.test(rawThreadName)
        ? rawThreadName
        : undefined;

    log.info(
      `New Google Chat message from ${senderName}: ${text.slice(0, 50)}`,
    );

    handleMessage(
      senderEmail,
      senderName,
      text,
      timestamp,
      spaceName,
      threadName,
    ).catch((err: unknown) => {
      log.error(`handleMessage error: ${formatError(err)}`);
    });
  }

  function readBody(
    req: http.IncomingMessage,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalLength = 0;
      let rejected = false;

      req.on("data", (chunk: Buffer) => {
        if (rejected) return;
        totalLength += chunk.length;
        if (totalLength > MAX_REQUEST_BODY_SIZE) {
          rejected = true;
          req.destroy();
          reject(new Error("Request body too large"));
          return;
        }
        chunks.push(chunk);
      });

      req.on("end", () => {
        if (!rejected) resolve(Buffer.concat(chunks));
      });

      req.on("error", (err) => {
        if (!rejected) reject(err);
      });
    });
  }

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // Health check
    if (method === "GET" && url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    // Webhook endpoint
    if (method === "POST" && url === "/") {
      if (!verifyToken(req.headers.authorization, webhookToken)) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }

      // Respond 200 immediately, process async
      readBody(req)
        .then((body) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");

          try {
            const event = JSON.parse(body.toString("utf-8")) as GoogleChatEvent;
            processEvent(event);
          } catch (err) {
            log.warn(`Failed to parse webhook event: ${formatError(err)}`);
          }
        })
        .catch((err) => {
          log.warn(`Failed to read webhook body: ${formatError(err)}`);
          if (!res.headersSent) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Bad Request");
          }
        });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  server.listen(port, webhookHost, () => {
    log.info(`Google Chat webhook server listening on ${webhookHost}:${port}`);
  });

  server.on("error", (err) => {
    log.error(`Google Chat webhook server error: ${formatError(err)}`);
  });

  log.info("Google Chat gateway starting...");

  return {
    stop: () => {
      server.close();
      log.info("Google Chat gateway stopped");
    },
  };
}
