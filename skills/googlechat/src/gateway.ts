import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { GoogleAuth, type OAuth2Client } from "google-auth-library";
import type { GatewayInboundMessage, NormalizedChatType } from "../../../src/channels/plugins/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GoogleChatGatewayHandle = {
  readonly server: Server;
  readonly sendMessage: (
    spaceId: string,
    text: string,
  ) => Promise<{ ok: boolean; messageId?: string }>;
  readonly sendMedia: (
    spaceId: string,
    media: Buffer,
    mimeType: string,
    caption?: string,
  ) => Promise<{ ok: boolean; messageId?: string }>;
  readonly stop: () => Promise<void>;
};

export type GoogleChatGatewayParams = {
  port?: number;
  credentialsPath?: string;
  onMessage: (msg: GatewayInboundMessage) => Promise<void>;
  verificationToken?: string;
  allowFrom?: string[];
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
};

// Google Chat event payload shapes (subset we care about)
type ChatEventUser = {
  name?: string;
  displayName?: string;
  type?: string;
  email?: string;
};

type ChatEventSpace = {
  name?: string;
  type?: string;
  displayName?: string;
};

type ChatEventThread = {
  name?: string;
};

type ChatEventMessage = {
  name?: string;
  sender?: ChatEventUser;
  createTime?: string;
  text?: string;
  thread?: ChatEventThread;
  space?: ChatEventSpace;
  attachment?: ReadonlyArray<Record<string, unknown>>;
};

type ChatEvent = {
  type?: string;
  eventTime?: string;
  message?: ChatEventMessage;
  user?: ChatEventUser;
  space?: ChatEventSpace;
  configCompleteRedirectUrl?: string;
};

// Chat API response shapes
type ChatApiMessage = {
  name?: string;
  text?: string;
  thread?: { name?: string };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHAT_API_BASE = "https://chat.googleapis.com/v1";
const CHAT_API_SCOPE = "https://www.googleapis.com/auth/chat.bot";
const DEFAULT_PORT = 8765;
const MAX_MESSAGE_LENGTH = 8000;
const SPACE_ID_PATTERN = /^spaces\/[a-zA-Z0-9_-]+$/;
const MIME_TYPE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9!#$&\-.^_+]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-.^_+]*$/;

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function createAuthClient(
  credentialsPath?: string,
): Promise<OAuth2Client> {
  const authOptions: ConstructorParameters<typeof GoogleAuth>[0] = {
    scopes: [CHAT_API_SCOPE],
  };

  if (credentialsPath) {
    const raw = await readFile(credentialsPath, "utf-8");
    const credentials = JSON.parse(raw) as Record<string, unknown>;
    authOptions.credentials = credentials as {
      client_email: string;
      private_key: string;
    };
  }

  // Falls back to GOOGLE_APPLICATION_CREDENTIALS env var or metadata server
  const auth = new GoogleAuth(authOptions);
  const client = (await auth.getClient()) as OAuth2Client;
  return client;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let settled = false;
    const MAX_BODY = 1024 * 1024; // 1MB limit

    req.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY) {
        settled = true;
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function safeTokenCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(maxLen);
  const paddedB = Buffer.alloc(maxLen);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

function sendJsonResponse(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

export async function startGoogleChatGateway(
  params: GoogleChatGatewayParams,
): Promise<GoogleChatGatewayHandle> {
  const {
    onMessage,
    allowFrom,
    verificationToken,
    logger,
  } = params;
  const port = params.port ?? (Number(process.env.GOOGLE_CHAT_WEBHOOK_PORT) || DEFAULT_PORT);
  const credentialsPath =
    params.credentialsPath ?? process.env.GOOGLE_CHAT_CREDENTIALS ?? undefined;

  if (!verificationToken) {
    logger?.warn(
      "No verification token configured — webhook endpoint is unauthenticated. " +
      "Set GOOGLE_CHAT_VERIFICATION_TOKEN or channels.googlechat.token in config.",
    );
  }

  // Authenticate with Google
  const authClient = await createAuthClient(credentialsPath);

  // ------- API helpers -------

  function validateSpaceId(spaceId: string): string {
    const normalized = spaceId.startsWith("spaces/") ? spaceId : `spaces/${spaceId}`;
    if (!SPACE_ID_PATTERN.test(normalized)) {
      throw new Error(`Invalid space ID: ${spaceId}`);
    }
    return normalized;
  }

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const tokenResponse = await authClient.getAccessToken();
    if (!tokenResponse.token) {
      throw new Error("Failed to obtain Google access token");
    }
    return {
      Authorization: `Bearer ${tokenResponse.token}`,
      "Content-Type": "application/json",
    };
  }

  async function sendMessage(
    spaceId: string,
    text: string,
  ): Promise<{ ok: boolean; messageId?: string }> {
    try {
      const parent = validateSpaceId(spaceId);
      const headers = await getAuthHeaders();
      const url = `${CHAT_API_BASE}/${parent}/messages`;

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger?.error(`Google Chat API error (${response.status}): ${errorText}`);
        return { ok: false };
      }

      const data = (await response.json()) as ChatApiMessage;
      return { ok: true, messageId: data.name ?? undefined };
    } catch (err) {
      logger?.error(
        `Failed to send Google Chat message: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false };
    }
  }

  async function sendMedia(
    spaceId: string,
    media: Buffer,
    mimeType: string,
    caption?: string,
  ): Promise<{ ok: boolean; messageId?: string }> {
    try {
      if (!MIME_TYPE_PATTERN.test(mimeType)) {
        logger?.error(`Invalid MIME type: ${mimeType}`);
        return { ok: false };
      }
      const parent = validateSpaceId(spaceId);
      const headers = await getAuthHeaders();

      // Upload attachment via multipart upload
      const uploadUrl = `https://chat.googleapis.com/upload/v1/media/${parent}/attachments/upload?updateMask=filename`;

      const boundary = `----GoogleChatBoundary${Date.now()}`;
      const metadata = JSON.stringify({ filename: `attachment.${extensionFromMime(mimeType)}` });

      const parts = [
        `--${boundary}\r\n`,
        `Content-Type: application/json; charset=UTF-8\r\n\r\n`,
        `${metadata}\r\n`,
        `--${boundary}\r\n`,
        `Content-Type: ${mimeType}\r\n`,
        `Content-Transfer-Encoding: binary\r\n\r\n`,
      ];

      const prefix = Buffer.from(parts.join(""));
      const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([prefix, media, suffix]);

      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      });

      if (!uploadResponse.ok) {
        // Fall back to text-only message with caption
        logger?.warn("Media upload failed, sending caption as text");
        if (caption) {
          return sendMessage(spaceId, caption);
        }
        return { ok: false };
      }

      const uploadData = (await uploadResponse.json()) as {
        attachmentDataRef?: { resourceName?: string };
      };
      const attachmentRef = uploadData.attachmentDataRef?.resourceName;

      // Send message with attachment reference
      const msgUrl = `${CHAT_API_BASE}/${parent}/messages`;
      const messageBody: Record<string, unknown> = {
        text: caption ?? "",
      };

      if (attachmentRef) {
        messageBody.attachment = [
          {
            contentName: `attachment.${extensionFromMime(mimeType)}`,
            contentType: mimeType,
            attachmentDataRef: { resourceName: attachmentRef },
          },
        ];
      }

      const msgResponse = await fetch(msgUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(messageBody),
      });

      if (!msgResponse.ok) {
        logger?.error(`Failed to send message with attachment: ${msgResponse.status}`);
        // Try text-only fallback
        if (caption) {
          return sendMessage(spaceId, caption);
        }
        return { ok: false };
      }

      const msgData = (await msgResponse.json()) as ChatApiMessage;
      return { ok: true, messageId: msgData.name ?? undefined };
    } catch (err) {
      logger?.error(
        `Failed to send Google Chat media: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Fall back to text if we have a caption
      if (caption) {
        return sendMessage(spaceId, caption);
      }
      return { ok: false };
    }
  }

  // ------- Event processing -------

  function isAllowed(user: ChatEventUser | undefined): boolean {
    if (!allowFrom || allowFrom.length === 0) return true;
    if (!user) return false;

    const email = user.email?.toLowerCase();
    const userId = user.name; // "users/123456"

    return allowFrom.some((entry) => {
      const lower = entry.toLowerCase();
      return lower === email || lower === userId;
    });
  }

  function resolveChatType(space: ChatEventSpace | undefined): NormalizedChatType {
    switch (space?.type) {
      case "DM":
        return "direct";
      case "ROOM":
      case "SPACE":
        return "group";
      default:
        return "direct";
    }
  }

  function processEvent(event: ChatEvent): void {
    if (event.type !== "MESSAGE") return;

    const message = event.message;
    if (!message) return;

    const sender = message.sender;
    if (!sender) return;

    // Skip bot messages
    if (sender.type === "BOT") return;

    // Apply allowFrom filter
    if (!isAllowed(sender)) return;

    const rawText = message.text;
    if (!rawText) return;
    const text = rawText.length > MAX_MESSAGE_LENGTH
      ? rawText.slice(0, MAX_MESSAGE_LENGTH)
      : rawText;

    const space = message.space ?? event.space;
    const spaceId = space?.name ?? "";
    const chatType = resolveChatType(space);

    const inbound: GatewayInboundMessage = {
      from: sender.name ?? sender.email ?? "unknown",
      text,
      chatType,
      chatId: spaceId,
      timestamp: message.createTime
        ? new Date(message.createTime).getTime()
        : Date.now(),
      senderName: sender.displayName,
    };

    onMessage(inbound).catch((err) => {
      logger?.error(
        `Gateway onMessage handler failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  // ------- HTTP server -------

  const server = createServer(async (req, res) => {
    // Health check
    if (req.method === "GET" && req.url === "/health") {
      sendJsonResponse(res, 200, { status: "ok" });
      return;
    }

    // Only accept POST on root
    if (req.method !== "POST" || (req.url !== "/" && req.url !== "")) {
      sendJsonResponse(res, 404, { error: "Not found" });
      return;
    }

    try {
      // Verify token if configured
      if (verificationToken) {
        const authHeader = req.headers.authorization;
        const bearerToken = authHeader?.startsWith("Bearer ")
          ? authHeader.slice(7)
          : undefined;

        if (!bearerToken || !safeTokenCompare(bearerToken, verificationToken)) {
          logger?.warn("Webhook request failed verification token check");
          sendJsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
      }

      const body = await readRequestBody(req);
      const event = JSON.parse(body) as ChatEvent;

      // Respond immediately so Google Chat doesn't retry
      sendJsonResponse(res, 200, {});

      // Process asynchronously
      processEvent(event);
    } catch (err) {
      logger?.error(
        `Webhook processing error: ${err instanceof Error ? err.message : String(err)}`,
      );
      sendJsonResponse(res, 400, { error: "Invalid request" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.removeListener("error", reject);
      logger?.info(`Google Chat webhook listening on port ${port}`);
      resolve();
    });
  });

  const handle: GoogleChatGatewayHandle = {
    server,
    sendMessage,
    sendMedia,
    stop: async () => {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          resolve();
        }, 5000);
        server.close(() => {
          clearTimeout(timeout);
          resolve();
        });
        server.closeAllConnections();
      });
      logger?.info("Google Chat gateway stopped");
    },
  };

  return handle;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function extensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "application/pdf": "pdf",
  };
  return map[mimeType] ?? "bin";
}
