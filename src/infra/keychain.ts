import { execFileSync } from "node:child_process";
import { platform } from "node:os";
import { createLogger } from "../logging.js";

const log = createLogger("infra:keychain");

type ClaudeCodeOauth = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

type KeychainEntry = {
  claudeAiOauth?: ClaudeCodeOauth;
};

/**
 * Read Claude Code OAuth credentials from macOS Keychain.
 * Returns the access token string, or null if unavailable.
 */
export function readClaudeCodeCredentials(): string | null {
  if (platform() !== "darwin") {
    return null;
  }

  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();

    let entry: KeychainEntry | null = null;
    try {
      entry = JSON.parse(raw) as KeychainEntry;
    } catch {
      log.warn("Failed to parse Keychain entry as JSON");
      return null;
    }

    const creds = entry?.claudeAiOauth;
    if (!creds?.accessToken) {
      log.warn("Keychain entry found but missing claudeAiOauth.accessToken");
      return null;
    }

    if (creds.expiresAt) {
      // 1e12 ms ≈ Sep 2001; timestamps below this are assumed to be in seconds
      const expiresAtMs = creds.expiresAt < 1e12 ? creds.expiresAt * 1000 : creds.expiresAt;
      // Add 60s buffer to prevent using a token that expires during initialization
      const TOKEN_EXPIRY_BUFFER_MS = 60_000;
      if (expiresAtMs < Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
        log.warn("Claude Code OAuth token has expired or is about to expire");
        return null;
      }
    }

    log.info("Using Claude Code OAuth token from Keychain");
    return creds.accessToken;
  } catch {
    log.debug("No Claude Code credentials in Keychain");
    return null;
  }
}
