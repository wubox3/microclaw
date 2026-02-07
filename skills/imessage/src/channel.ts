import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";
import {
  startIMessageGateway,
  type IMessageGatewayHandle,
} from "./gateway.js";

const execFileAsync = promisify(execFile);

const SEND_TIMEOUT_MS = 15_000;
const FILE_SEND_TIMEOUT_MS = 30_000;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

// Phone number, email, chat group id, or full iMessage chat id
const RECIPIENT_RE =
  /^(\+?[\d]{7,20}|[\w.%+-]+@[\w.-]+\.\w{2,}|chat\d+|iMessage;[-+];[^\x00-\x1f]+)$/;

function toAppleScriptChatId(to: string): string {
  if (to.startsWith("iMessage;")) return to;
  if (to.startsWith("chat")) return `iMessage;+;${to}`;
  return `iMessage;-;${to}`;
}

function isValidRecipient(to: string): boolean {
  if (!to || to.length > 200) return false;
  return RECIPIENT_RE.test(to);
}

function sanitizeExtension(mimeType: string): string {
  const raw = mimeType.split("/")[1] ?? "bin";
  return raw.replace(/[^a-zA-Z0-9]/g, "") || "bin";
}

async function sendTextViaAppleScript(
  chatId: string,
  text: string,
): Promise<{ ok: boolean }> {
  try {
    await execFileAsync(
      "osascript",
      [
        "-e", "on run argv",
        "-e", "tell application \"Messages\"",
        "-e", "send (item 1 of argv) to chat id (item 2 of argv)",
        "-e", "end tell",
        "-e", "end run",
        "--",
        text,
        chatId,
      ],
      { timeout: SEND_TIMEOUT_MS },
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function sendFileViaAppleScript(
  chatId: string,
  filePath: string,
): Promise<{ ok: boolean }> {
  try {
    await execFileAsync(
      "osascript",
      [
        "-e", "on run argv",
        "-e", "tell application \"Messages\"",
        "-e", "send POSIX file (item 1 of argv) to chat id (item 2 of argv)",
        "-e", "end tell",
        "-e", "end run",
        "--",
        filePath,
        chatId,
      ],
      { timeout: FILE_SEND_TIMEOUT_MS },
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function createIMessagePlugin(): ChannelPlugin {
  let activeHandle: IMessageGatewayHandle | undefined;

  return {
    id: "imessage",
    meta: {
      id: "imessage",
      label: "iMessage",
      selectionLabel: "iMessage",
      blurb: "iMessage integration (macOS only).",
      aliases: ["imsg"],
    },
    capabilities: {
      chatTypes: ["direct", "group"],
      reactions: true,
      media: true,
    },
    config: {
      isConfigured: () => process.platform === "darwin",
      isEnabled: (cfg) => cfg.channels?.imessage?.enabled !== false,
    },
    outbound: {
      textChunkLimit: 4000,
      sendText: async ({ to, text }) => {
        if (process.platform !== "darwin") return { ok: false };
        if (!isValidRecipient(to)) return { ok: false };
        const chatId = toAppleScriptChatId(to);
        return sendTextViaAppleScript(chatId, text);
      },
      sendMedia: async ({ to, media, mimeType, caption }) => {
        if (process.platform !== "darwin") return { ok: false };
        if (!isValidRecipient(to)) return { ok: false };
        if (media.length > MAX_FILE_SIZE) return { ok: false };

        const chatId = toAppleScriptChatId(to);
        const ext = sanitizeExtension(mimeType);
        const tmpPath = join(
          tmpdir(),
          `microclaw-${randomBytes(8).toString("hex")}.${ext}`,
        );

        try {
          await writeFile(tmpPath, media, { mode: 0o600 });
          const result = await sendFileViaAppleScript(chatId, tmpPath);

          if (result.ok && caption) {
            await sendTextViaAppleScript(chatId, caption);
          }

          return result;
        } finally {
          await unlink(tmpPath).catch(() => {});
        }
      },
    },
    gateway: {
      startAccount: async ({ config, onMessage }) => {
        if (process.platform !== "darwin") {
          throw new Error(
            "iMessage is only available on macOS. Ensure Full Disk Access is granted to your terminal.",
          );
        }

        if (activeHandle) {
          await activeHandle.stop();
          activeHandle = undefined;
        }

        activeHandle = await startIMessageGateway({
          allowFrom: config.channels?.imessage?.allowFrom,
          onMessage: onMessage ?? (async () => {}),
        });

        return activeHandle;
      },
      stopAccount: async () => {
        if (activeHandle) {
          await activeHandle.stop();
          activeHandle = undefined;
        }
      },
    },
  };
}
