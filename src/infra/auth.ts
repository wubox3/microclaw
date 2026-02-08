import { execFileSync, spawnSync } from "node:child_process";
import { createLogger } from "../logging.js";
import { readClaudeCodeCredentials } from "./keychain.js";

const log = createLogger("infra:auth");

export type AuthCredentials = {
  apiKey?: string;
  authToken?: string;
  isOAuth: boolean;
};

/**
 * Attempt to resolve credentials from env vars and keychain.
 * Returns null if nothing found (does not throw).
 */
function tryResolveCredentials(): AuthCredentials | null {
  // 1. Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    log.info("Using ANTHROPIC_API_KEY from environment");
    return { apiKey, isOAuth: false };
  }

  // 2. Check for explicit OAuth token env var
  const envToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (envToken) {
    log.info("Using ANTHROPIC_AUTH_TOKEN from environment");
    return { authToken: envToken, isOAuth: true };
  }

  // 3. Try Claude Code OAuth from macOS Keychain
  const keychainToken = readClaudeCodeCredentials();
  if (keychainToken) {
    return { authToken: keychainToken, isOAuth: true };
  }

  return null;
}

/**
 * Check whether the `claude` CLI is available on PATH.
 */
function isClaudeCliAvailable(): boolean {
  try {
    execFileSync("which", ["claude"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn `claude setup-token` interactively so the user can authenticate
 * in the same terminal. Returns the exit code (0 = success).
 */
function spawnClaudeLogin(): number {
  log.info("No credentials found. Launching Claude Code login...");
  const result = spawnSync("claude", ["setup-token"], {
    stdio: "inherit",
    timeout: 300_000, // 5 minute timeout for interactive login
  });
  return result.status ?? 1;
}

/**
 * Resolve Anthropic authentication credentials.
 *
 * Priority order:
 * 1. ANTHROPIC_API_KEY environment variable
 * 2. ANTHROPIC_AUTH_TOKEN environment variable (OAuth token)
 * 3. Claude Code OAuth token from macOS Keychain
 * 4. Interactive login via `claude setup-token` (if CLI available)
 */
export async function resolveAuthCredentials(): Promise<AuthCredentials> {
  // Fast path: existing credentials
  const existing = tryResolveCredentials();
  if (existing) {
    return existing;
  }

  // No credentials found — try interactive login
  if (!isClaudeCliAvailable()) {
    throw new Error(
      "No Anthropic credentials found and Claude CLI is not installed. " +
      "Set ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or install Claude Code (https://docs.anthropic.com/en/docs/claude-code) and run `claude setup-token`.",
    );
  }

  const exitCode = spawnClaudeLogin();
  if (exitCode !== 0) {
    log.warn(`Claude login exited with code ${exitCode}`);
  }

  // Re-check credentials after login
  const postLogin = tryResolveCredentials();
  if (postLogin) {
    return postLogin;
  }

  throw new Error(
    "No Anthropic credentials found after login attempt. " +
    "Please try running `claude setup-token` manually in your terminal.",
  );
}
