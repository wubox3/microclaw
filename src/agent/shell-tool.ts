import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { createLogger } from "../logging.js";
import type { AgentTool, AgentToolResult } from "./types.js";

const log = createLogger("shell-tool");

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 50_000;
const MAX_SESSIONS = 10;
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_BUFFER_LIMIT = 100 * 1024 * 1024; // 100MB default per-command buffer
const MAX_BUFFER_LIMIT = 4 * 1024 * 1024 * 1024; // 4GB hard ceiling

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

// Commands explicitly allowed to bypass the blocklist.
// Matched against the first token (binary name) of the command.
const ALLOWED_COMMANDS = new Set([
  "claude",
]);

// ---------------------------------------------------------------------------
// Session types and state
// ---------------------------------------------------------------------------

interface ShellSession {
  readonly id: string;
  readonly process: ChildProcess;
  readonly cwd: string;
  readonly createdAt: number;
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout>;
  busy: Promise<void> | null;
}

const sessions = new Map<string, ShellSession>();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Resolve a path to its real (symlink-free) absolute form. Returns resolved on failure. */
function safeRealpath(p: string): string {
  try {
    return realpathSync(pathResolve(p));
  } catch {
    return pathResolve(p);
  }
}

/** Log resolved paths at debug level before command execution. */
function logResolvedPaths(
  cwd: string,
  command: string,
  shellPath: string,
  sessionId?: string,
): void {
  const resolvedCwd = safeRealpath(cwd);
  const prefix = sessionId ? `[session:${sessionId}] ` : "";
  log.debug(`${prefix}resolved cwd: ${resolvedCwd}`);
  log.debug(`${prefix}command: ${command.slice(0, 500)}`);
  const dirs = shellPath.split(":");
  log.debug(`${prefix}PATH (${dirs.length} directories):`);
  for (const dir of dirs) {
    log.debug(`${prefix}  ${dir}`);
  }
}

/** Build env inheriting from process.env with the resolved shell PATH. */
function buildEnv(shellPath: string): NodeJS.ProcessEnv {
  return { ...process.env, PATH: shellPath };
}

function isBlockedCommand(command: string): boolean {
  const firstToken = command.trim().split(/\s+/)[0] ?? "";
  if (ALLOWED_COMMANDS.has(firstToken)) {
    return false;
  }
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }
  return output.slice(0, MAX_OUTPUT_CHARS) + `\n...[truncated, ${output.length - MAX_OUTPUT_CHARS} chars omitted]`;
}

function formatDisplaySummary(exitCode: number, stdout: string, stderr: string): string {
  if (exitCode === 0) {
    const totalLen = stdout.length + stderr.length;
    return `Command completed successfully (exit code 0, ${totalLen} chars output)`;
  }
  const preview = (stderr || stdout).slice(0, 200);
  return `Command failed (exit code ${exitCode}): ${preview}`;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

function resetIdleTimer(session: ShellSession): void {
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    destroySession(session.id);
    log.info(`Session ${session.id} timed out after idle`);
  }, SESSION_IDLE_TIMEOUT_MS);
  session.idleTimer.unref();
}

function destroySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId); // Remove first to prevent re-entry
  clearTimeout(session.idleTimer);
  try {
    if (!session.process.killed) {
      session.process.kill("SIGTERM");
      const forceTimer = setTimeout(() => {
        try { if (!session.process.killed) session.process.kill("SIGKILL"); } catch { /* already dead */ }
      }, 1000);
      forceTimer.unref();
    }
  } catch {
    // Process may already be dead
  }
}

function startSession(cwd: string, shellPath: string): AgentToolResult {
  if (sessions.size >= MAX_SESSIONS) {
    return {
      content: `Error: maximum number of sessions (${MAX_SESSIONS}) reached. End an existing session first.`,
      isError: true,
    };
  }

  const id = randomUUID().slice(0, 8);

  const proc = spawn("/bin/sh", [], {
    cwd,
    env: buildEnv(shellPath),
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (!proc.pid) {
    return { content: "Error: failed to spawn shell process.", isError: true };
  }

  const session: ShellSession = {
    id,
    process: proc,
    cwd,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    idleTimer: setTimeout(() => {}, 0),
    busy: null,
  };

  // Set up proper idle timer
  resetIdleTimer(session);

  // Auto-cleanup if the process exits unexpectedly
  proc.on("exit", () => {
    clearTimeout(session.idleTimer);
    sessions.delete(id);
  });

  sessions.set(id, session);
  log.debug(`Session ${id} resolved cwd: ${safeRealpath(cwd)}`);
  log.info(`Started shell session ${id} (pid ${proc.pid})`);

  return {
    content: JSON.stringify({ session_id: id, message: `Shell session started (pid ${proc.pid}).` }),
  };
}

async function runInSession(
  sessionId: string,
  command: string,
  display: boolean,
  bufferLimit: number,
  shellPath: string,
): Promise<AgentToolResult> {
  const session = sessions.get(sessionId);
  if (!session) {
    return { content: `Error: session "${sessionId}" not found.`, isError: true };
  }

  if (!session.process.stdin?.writable || session.process.killed) {
    destroySession(sessionId);
    return { content: `Error: session "${sessionId}" is no longer running.`, isError: true };
  }

  // Serialize commands per session — chain new promise before awaiting old one
  // to close the race window between await completing and new lock being set
  const previousBusy = session.busy ?? Promise.resolve();
  let resolveBusy: () => void = () => {};
  session.busy = new Promise<void>((r) => { resolveBusy = r; });
  await previousBusy;

  session.lastUsedAt = Date.now();
  resetIdleTimer(session);
  logResolvedPaths(session.cwd, command, shellPath, sessionId);

  const sentinel = `__MICROCLAW_DONE_${randomUUID()}__`;

  return new Promise<AgentToolResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      resolveBusy();
      resolve({
        content: `Command timed out after ${TIMEOUT_MS / 1000}s`,
        isError: true,
      });
    }, TIMEOUT_MS);
    timer.unref();

    const onStdout = (chunk: Buffer): void => {
      if (finished) return;
      stdout += chunk.toString();

      if (stdout.length > bufferLimit) {
        finished = true;
        clearTimeout(timer);
        cleanup();
        resolveBusy();
        resolve({
          content: `Error: command output exceeded buffer limit (${bufferLimit} bytes)`,
          isError: true,
        });
        return;
      }

      const sentinelIdx = stdout.indexOf(sentinel);
      if (sentinelIdx !== -1) {
        finished = true;
        clearTimeout(timer);

        // Parse exit code from "SENTINEL:exitcode" line
        const afterSentinel = stdout.slice(sentinelIdx + sentinel.length);
        const exitCodeMatch = afterSentinel.match(/:(\d+)/);
        const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : 0;

        // Remove sentinel line from output
        const cleanOutput = stdout.slice(0, sentinelIdx).trimEnd();

        cleanup();
        resolveBusy();

        if (display) {
          const combined = [cleanOutput, stderr.trim()].filter(Boolean).join("\n");
          resolve({
            content: truncateOutput(combined || "(no output)"),
            isError: exitCode !== 0 ? true : undefined,
          });
        } else {
          resolve({
            content: formatDisplaySummary(exitCode, cleanOutput, stderr.trim()),
            isError: exitCode !== 0 ? true : undefined,
          });
        }
      }
    };

    const onStderr = (chunk: Buffer): void => {
      if (finished) return;
      stderr += chunk.toString();
    };

    const onExit = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      resolveBusy();
      resolve({
        content: `Session "${sessionId}" process exited unexpectedly.`,
        isError: true,
      });
    };

    const cleanup = (): void => {
      session.process.stdout?.off("data", onStdout);
      session.process.stderr?.off("data", onStderr);
      session.process.off("exit", onExit);
    };

    session.process.stdout?.on("data", onStdout);
    session.process.stderr?.on("data", onStderr);
    session.process.on("exit", onExit);

    // Refresh PATH before running the command
    const escapedPath = shellPath.replace(/'/g, "'\\''");
    session.process.stdin!.write(`export PATH='${escapedPath}'\n${command}\necho "${sentinel}:$?"\n`);
  });
}

function endSession(sessionId: string): AgentToolResult {
  const session = sessions.get(sessionId);
  if (!session) {
    return { content: `Error: session "${sessionId}" not found.`, isError: true };
  }

  destroySession(sessionId);
  log.info(`Ended shell session ${sessionId}`);
  return { content: `Session "${sessionId}" ended.` };
}

/** Kill all persistent shell sessions. Call during process shutdown. */
export function cleanupAllSessions(): void {
  for (const id of Array.from(sessions.keys())) {
    destroySession(id);
  }
  log.info("All shell sessions cleaned up");
}

/** Expose session count for testing. */
export function getSessionCount(): number {
  return sessions.size;
}

// ---------------------------------------------------------------------------
// One-off command execution (original behavior)
// ---------------------------------------------------------------------------

function runOneOff(command: string, cwd: string, display: boolean, bufferLimit: number, shellPath: string): Promise<AgentToolResult> {
  logResolvedPaths(cwd, command, shellPath);
  return new Promise((resolve) => {
    execFile("/bin/sh", ["-c", command], { cwd, timeout: TIMEOUT_MS, maxBuffer: bufferLimit, env: buildEnv(shellPath) }, (error, stdout, stderr) => {
      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();

      if (error) {
        const message = error.killed
          ? `Command timed out after ${TIMEOUT_MS / 1000}s`
          : error.signal
            ? `Command killed by signal ${error.signal}`
            : combined || error.message;

        log.warn(`Shell command failed: ${command.slice(0, 200)}`);

        if (display) {
          resolve({ content: truncateOutput(message), isError: true });
        } else {
          const exitCode = error.code ?? 1;
          resolve({
            content: formatDisplaySummary(typeof exitCode === "number" ? exitCode : 1, stdout?.trim() ?? "", stderr?.trim() ?? ""),
            isError: true,
          });
        }
        return;
      }

      log.debug(`Shell command succeeded: ${command.slice(0, 200)}`);

      if (display) {
        resolve({ content: truncateOutput(combined || "(no output)") });
      } else {
        resolve({
          content: formatDisplaySummary(0, stdout?.trim() ?? "", stderr?.trim() ?? ""),
        });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createShellTool(opts: { cwd: string; shellPath?: string }): AgentTool {
  const { cwd, shellPath = process.env.PATH ?? "/usr/bin:/bin" } = opts;

  const shellDirs = shellPath.split(":");
  log.debug(`Shell PATH (${shellDirs.length} directories):`);
  for (const dir of shellDirs) {
    log.debug(`  PATH: ${dir}`);
  }

  return {
    name: "shell",
    description:
      "Run shell commands in the user's workspace. Supports one-off commands and persistent sessions " +
      "where state (cwd, variables) is preserved across commands. " +
      "Use 'start_session' to create a persistent shell, 'run_in_session' to execute in it, " +
      "'end_session' to close it, or 'run' (default) for one-off commands. " +
      "Commands time out after 30 seconds.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["run", "start_session", "run_in_session", "end_session"],
          description: "Shell action. Defaults to 'run' for one-off commands.",
        },
        command: {
          type: "string",
          description: "The shell command to execute (required for 'run' and 'run_in_session')",
        },
        session_id: {
          type: "string",
          description: "Session ID (required for 'run_in_session' and 'end_session')",
        },
        display: {
          type: "boolean",
          description: "Whether to show full output (true, default) or just a brief summary (false)",
        },
        buffer_limit: {
          type: "number",
          description: "Per-command output buffer limit in bytes. Defaults to 100MB, max 4GB.",
        },
      },
      required: ["command"],
    },
    execute: async (params): Promise<AgentToolResult> => {
      const action = typeof params.action === "string" ? params.action : "run";
      const command = typeof params.command === "string" ? params.command.trim() : "";
      const sessionId = typeof params.session_id === "string" ? params.session_id : "";
      const display = typeof params.display === "boolean" ? params.display : true;
      const rawBufferLimit = typeof params.buffer_limit === "number" ? params.buffer_limit : DEFAULT_BUFFER_LIMIT;
      const bufferLimit = Math.max(1, Math.min(rawBufferLimit, MAX_BUFFER_LIMIT));

      switch (action) {
        case "start_session": {
          return startSession(cwd, shellPath);
        }

        case "end_session": {
          if (sessionId === "") {
            return { content: "Error: session_id is required for 'end_session'.", isError: true };
          }
          return endSession(sessionId);
        }

        case "run_in_session": {
          if (sessionId === "") {
            return { content: "Error: session_id is required for 'run_in_session'.", isError: true };
          }
          if (command === "") {
            return { content: "Error: command is required and must be a non-empty string.", isError: true };
          }
          if (isBlockedCommand(command)) {
            log.warn(`Blocked dangerous shell command in session: ${command.slice(0, 200)}`);
            return { content: "Error: this command has been blocked for safety. Destructive system commands are not permitted.", isError: true };
          }
          return runInSession(sessionId, command, display, bufferLimit, shellPath);
        }

        case "run":
        default: {
          if (command === "") {
            return { content: "Error: command is required and must be a non-empty string.", isError: true };
          }
          if (isBlockedCommand(command)) {
            log.warn(`Blocked dangerous shell command: ${command.slice(0, 200)}`);
            return { content: "Error: this command has been blocked for safety. Destructive system commands are not permitted.", isError: true };
          }
          return runOneOff(command, cwd, display, bufferLimit, shellPath);
        }
      }
    },
  };
}
