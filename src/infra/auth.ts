import { createLogger } from "../logging.js";
import { readClaudeCodeCredentials } from "./keychain.js";

const log = createLogger("infra:auth");

export type AuthCredentials = {
  apiKey?: string;
  authToken?: string;
  isOAuth: boolean;
};

/**
 * Resolve Anthropic authentication credentials.
 *
 * Priority order:
 * 1. ANTHROPIC_API_KEY environment variable
 * 2. ANTHROPIC_AUTH_TOKEN environment variable (OAuth token)
 * 3. Claude Code OAuth token from macOS Keychain
 */
export function resolveAuthCredentials(): AuthCredentials {
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

  throw new Error(
    "No Anthropic credentials found. Set ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or install Claude Code and log in.",
  );
}
