import { exec } from "node:child_process";
import { createLogger } from "../logging.js";
import type { AgentTool, AgentToolResult } from "./types.js";

const log = createLogger("shell-tool");

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 50_000;

// Blocklist of dangerous command patterns to prevent misuse via prompt injection
const BLOCKED_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\//i,  // rm -rf /
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\//i,
  /\bmkfs\b/i,
  /\bdd\s+.*\bof=/i,
  />\s*\/dev\/sd/i,
  /\bcurl\b.*\|\s*(ba)?sh/i,
  /\bwget\b.*\|\s*(ba)?sh/i,
  /\bnc\s+(-[a-zA-Z]*e|-[a-zA-Z]*c)\b/i,
  /\bchmod\s+[0-7]*777\s+\//i,
  /\bchown\b.*\//i,
  /\/etc\/shadow/i,
  /\/etc\/passwd/i,
  /~\/\.ssh\//i,
  /\.ssh\/.*id_/i,
  /\bsudo\b/i,
  /\bsu\s+-?\s*(root)?\s*$/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\biptables\b/i,
  /\b:(){/,  // fork bomb
  /\b(env|printenv)\b/i,  // environment variable exfiltration
  /\bexport\s+-p\b/i,     // export -p lists all env vars
  /\/proc\/self\//i,       // /proc filesystem access
  /\/proc\/\d+\//i,        // /proc/<pid> access
  /\bcat\b.*\.env\b/i,    // .env file access
  /\bless\b.*\.env\b/i,
  /\bhead\b.*\.env\b/i,
  /\btail\b.*\.env\b/i,
  /\bgrep\b.*\.env\b/i,
  /bash\s+<\s*\(/i,       // process substitution
] as const;

// Sanitized environment for exec: only safe variables, no API keys or secrets
const SAFE_ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  USER: process.env.USER,
  SHELL: process.env.SHELL,
  LANG: process.env.LANG,
  TERM: process.env.TERM,
  NODE_ENV: process.env.NODE_ENV,
};

function isBlockedCommand(command: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }
  return output.slice(0, MAX_OUTPUT_CHARS) + `\n...[truncated, ${output.length - MAX_OUTPUT_CHARS} chars omitted]`;
}

export function createShellTool(opts: { cwd: string }): AgentTool {
  const { cwd } = opts;

  return {
    name: "shell",
    description:
      "Run a shell command in the user's workspace. Supports pipes, redirects, and standard shell syntax. " +
      "Use for file listing, git operations, searching, building, testing, and other command-line tasks. " +
      "Commands time out after 30 seconds.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute (e.g. 'ls -la', 'git status', 'grep -r pattern .')",
        },
      },
      required: ["command"],
    },
    execute: async (params): Promise<AgentToolResult> => {
      const command = typeof params.command === "string" ? params.command.trim() : "";

      if (command === "") {
        return { content: "Error: command is required and must be a non-empty string.", isError: true };
      }

      if (isBlockedCommand(command)) {
        log.warn(`Blocked dangerous shell command: ${command.slice(0, 200)}`);
        return { content: "Error: this command has been blocked for safety. Destructive system commands are not permitted.", isError: true };
      }

      return new Promise((resolve) => {
        exec(command, { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, env: SAFE_ENV }, (error, stdout, stderr) => {
          const combined = [stdout, stderr].filter(Boolean).join("\n").trim();

          if (error) {
            const message = error.killed
              ? `Command timed out after ${TIMEOUT_MS / 1000}s`
              : error.signal
                ? `Command killed by signal ${error.signal}`
                : combined || error.message;

            log.warn(`Shell command failed: ${command.slice(0, 200)}`);
            resolve({ content: truncateOutput(message), isError: true });
            return;
          }

          log.debug(`Shell command succeeded: ${command.slice(0, 200)}`);
          resolve({ content: truncateOutput(combined || "(no output)") });
        });
      });
    },
  };
}
