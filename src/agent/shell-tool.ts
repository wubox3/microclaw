import { execFile } from "node:child_process";
import { createLogger } from "../logging.js";
import type { AgentTool, AgentToolResult } from "./types.js";

const log = createLogger("shell-tool");

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 50_000;

// Defense-in-depth blocklist of dangerous command patterns to prevent misuse
// via prompt injection. The real security boundary should be container sandboxing;
// this blocklist is an additional safety layer.
const BLOCKED_PATTERNS = [
  // Destructive filesystem commands
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\//i,
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\//i,
  /\bmkfs\b/i,
  /\bdd\s+.*\bof=/i,
  />\s*\/dev\/sd/i,

  // Pipe-to-shell / remote code execution
  /\bcurl\b.*\|\s*(ba)?sh/i,
  /\bwget\b.*\|\s*(ba)?sh/i,
  /\bcurl\b.*-d\b/i,
  /\bwget\b.*--post/i,
  /\bscp\b/i,
  /\brsync\b/i,

  // Netcat reverse shells
  /\bnc\s+(-[a-zA-Z]*e|-[a-zA-Z]*c)\b/i,

  // Privilege escalation and system control
  /\bchmod\s+[0-7]*777\s+\//i,
  /\bchown\b.*\//i,
  /\bsudo\b/i,
  /\bsu\s+-?\s*(root)?\s*$/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\biptables\b/i,

  // Sensitive file access
  /\/etc\/shadow/i,
  /\/etc\/passwd/i,
  /~\/\.ssh\//i,
  /\.ssh\/.*id_/i,
  /\bcat\b.*\.env\b/i,
  /\bless\b.*\.env\b/i,
  /\bhead\b.*\.env\b/i,
  /\btail\b.*\.env\b/i,
  /\bgrep\b.*\.env\b/i,

  // Environment exfiltration
  /\b(env|printenv)\b/i,
  /\bexport\s+-p\b/i,

  // /proc filesystem access (direct and indirect PID lookups)
  /\/proc\/self\//i,
  /\/proc\/\d+\//i,
  /\/proc\/\$[\w{]/i,
  /\/proc\/`[^`]*`/i,
  /\/proc\/\$\([^)]*\)/i,

  // Fork bomb
  /:\(\)\s*\{/,

  // Process substitution
  /bash\s+<\s*\(/i,

  // Language interpreter bypass (base64 decode, eval, etc.)
  /\bbase64\b/i,
  /\bpython\b/i,
  /\bpython3\b/i,
  /\bnode\b/i,
  /\bperl\b/i,
  /\bruby\b/i,
  /\bphp\b/i,

  // Eval / exec / indirect execution
  /\beval\b/i,
  /\bexec\b/i,
  /\bxargs\b/i,
  /\bfind\b.*-exec\b/i,
  /\btee\b/i,
  /\bcompgen\b/i,
  /\bdeclare\b/i,
  /^\s*set\b/i,

  // Subshell and variable expansion patterns (bypass vectors)
  /`[^`]+`/,
  /\$\([^)]+\)/,
  /\$\{[^}]+\}/,
  /\$[a-zA-Z_]\w*/,
] as const;

// Sanitized environment for exec: only safe variables, no API keys or secrets
// Computed lazily so it captures values after loadDotenv() has run
function buildSafeEnv(): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    LANG: process.env.LANG,
    TERM: process.env.TERM,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: process.env.NODE_ENV,
  };
}

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

      // Defense-in-depth: explicitly set shell via execFile to avoid inheriting
      // unexpected shell behavior. The real security should come from container sandboxing.
      return new Promise((resolve) => {
        execFile("/bin/sh", ["-c", command], { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, env: buildSafeEnv() }, (error, stdout, stderr) => {
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
