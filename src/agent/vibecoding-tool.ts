import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import crypto from "node:crypto";
import { createLogger } from "../logging.js";
import { expandPath } from "../config/paths.js";

const log = createLogger("vibecoding");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PROMPT_LENGTH = 50_000;
const MAX_OUTPUT_LENGTH = 100_000;
const PROCESS_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 20;
const MIN_SESSION_INTERVAL_MS = 5_000;

/** Claude CLI flags that must never appear in user prompts */
const FORBIDDEN_FLAGS = [
  "--dangerously-skip-permissions",
  "--allowedTools",
  "--model",
  "--max-turns",
  "--permission-mode",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VibecodingSession = {
  readonly sessionId: string;
  readonly chatKey: string;
  readonly cwd: string;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly activeProcess: ChildProcess | null;
};

export type SendChunkFn = (chunk: string) => void;

export type HandleCommandOpts = {
  readonly chatKey: string;
  readonly prompt: string;
  readonly sendChunk?: SendChunkFn;
  readonly textChunkLimit?: number;
};

export type VibecodingManager = {
  handleCommand: (opts: HandleCommandOpts) => Promise<string>;
  getSessionStatus: (chatKey: string) => VibecodingSessionStatus | undefined;
  stopSession: (chatKey: string) => boolean;
  cleanupAll: () => void;
  /** Exposed for testing */
  readonly sessions: ReadonlyMap<string, VibecodingSession>;
};

export type VibecodingSessionStatus = {
  readonly sessionId: string;
  readonly cwd: string;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly isRunning: boolean;
};

export type VibecodingManagerOpts = {
  readonly defaultCwd: string;
  readonly timeoutMs?: number;
  readonly maxSessions?: number;
  /** Tools to allow in the Claude CLI subprocess (e.g. ["Bash(npm:*)", "Bash(npx:*)"]) */
  readonly allowedTools?: readonly string[];
};

// ---------------------------------------------------------------------------
// Command parsing
// ---------------------------------------------------------------------------

type ParsedCommand =
  | { kind: "prompt"; cwd: string | undefined; text: string }
  | { kind: "stop" }
  | { kind: "status" }
  | { kind: "error"; message: string };

function parseVibecodingCommand(raw: string): ParsedCommand {
  // Strip "vibecoding " prefix
  const body = raw.replace(/^vibecoding\s+/, "");

  if (body === "/stop") {
    return { kind: "stop" };
  }
  if (body === "/status") {
    return { kind: "status" };
  }

  // Parse optional --cwd flag
  const cwdMatch = body.match(/^--cwd\s+(\S+)\s+([\s\S]+)$/);
  const text = cwdMatch ? cwdMatch[2].trim() : body.trim();
  const cwd = cwdMatch ? cwdMatch[1] : undefined;

  // Reject forbidden CLI flags in prompt text
  for (const flag of FORBIDDEN_FLAGS) {
    if (text.includes(flag)) {
      return { kind: "error", message: `Forbidden flag in prompt: ${flag}` };
    }
  }

  return { kind: "prompt", cwd, text };
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

async function validateCwd(raw: string, defaultCwd: string): Promise<string> {
  const expanded = expandPath(raw, defaultCwd);
  const normalizedDefault = resolve(defaultCwd);
  const normalizedExpanded = resolve(expanded);

  // Prevent path traversal outside project root
  if (normalizedExpanded !== normalizedDefault && !normalizedExpanded.startsWith(normalizedDefault + "/")) {
    throw new Error(`Directory must be within project root: ${normalizedDefault}`);
  }

  try {
    const st = await stat(expanded);
    if (!st.isDirectory()) {
      throw new Error(`Not a valid directory: ${expanded}`);
    }
  } catch (err) {
    if (err instanceof Error && (err.message.startsWith("Not a valid") || err.message.startsWith("Directory must"))) {
      throw err;
    }
    throw new Error(`Cannot access directory: ${expanded}`);
  }
  return expanded;
}

function formatSessionStatus(session: VibecodingSession): string {
  const age = Math.round((Date.now() - session.createdAt) / 1000);
  const idle = Math.round((Date.now() - session.lastActivityAt) / 1000);
  const running = session.activeProcess !== null ? "yes" : "no";
  return [
    `Session: ${session.sessionId}`,
    `Working directory: ${session.cwd}`,
    `Age: ${age}s`,
    `Idle: ${idle}s`,
    `Process running: ${running}`,
  ].join("\n");
}

function chunkText(text: string, limit: number): readonly string[] {
  if (text.length <= limit) {
    return [text];
  }
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    chunks.push(text.slice(offset, offset + limit));
    offset += limit;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Subprocess execution
// ---------------------------------------------------------------------------

function runClaude(opts: {
  prompt: string;
  sessionId: string;
  isResume: boolean;
  cwd: string;
  timeoutMs: number;
  onStdout?: SendChunkFn;
  allowedTools?: readonly string[];
}): { process: ChildProcess; result: Promise<string> } {
  const args = opts.isResume
    ? ["--resume", opts.sessionId, "-p", opts.prompt]
    : ["-p", opts.prompt, "--session-id", opts.sessionId];

  if (opts.allowedTools && opts.allowedTools.length > 0) {
    for (const tool of opts.allowedTools) {
      args.push("--allowedTools", tool);
    }
  }

  const child = spawn("claude", args, {
    cwd: opts.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  const result = new Promise<string>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let totalLength = 0;
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5000);
    }, opts.timeoutMs);

    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString("utf-8");
      totalLength += chunk.length;

      if (totalLength <= MAX_OUTPUT_LENGTH) {
        stdoutChunks.push(data);
        opts.onStdout?.(chunk);
      } else if (totalLength - chunk.length < MAX_OUTPUT_LENGTH) {
        // Partial last chunk
        const remaining = MAX_OUTPUT_LENGTH - (totalLength - chunk.length);
        const partial = chunk.slice(0, remaining);
        stdoutChunks.push(Buffer.from(partial, "utf-8"));
        opts.onStdout?.(partial);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderrChunks.push(data);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");

      if (killed) {
        resolve(stdout + "\n[Process timed out after 5 minutes]");
        return;
      }

      if (code !== 0 && stdout.length === 0) {
        reject(new Error(stderr.slice(0, 2000) || `claude exited with code ${code}`));
        return;
      }

      if (totalLength > MAX_OUTPUT_LENGTH) {
        resolve(stdout + `\n[Output truncated at ${MAX_OUTPUT_LENGTH} characters]`);
        return;
      }

      resolve(stdout);
    });
  });

  return { process: child, result };
}

// ---------------------------------------------------------------------------
// Immutable session update helper
// ---------------------------------------------------------------------------

function updateSession(
  sessions: Map<string, VibecodingSession>,
  chatKey: string,
  updates: Partial<Pick<VibecodingSession, "lastActivityAt" | "activeProcess">>,
): VibecodingSession | undefined {
  const session = sessions.get(chatKey);
  if (!session) {
    return undefined;
  }
  const updated: VibecodingSession = { ...session, ...updates };
  sessions.set(chatKey, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createVibecodingManager(opts: VibecodingManagerOpts): VibecodingManager {
  const { defaultCwd, timeoutMs = PROCESS_TIMEOUT_MS, maxSessions = DEFAULT_MAX_SESSIONS, allowedTools } = opts;
  const sessions = new Map<string, VibecodingSession>();
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastSessionCreation = new Map<string, number>();

  function resetIdleTimer(chatKey: string): void {
    const existing = idleTimers.get(chatKey);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      destroySession(chatKey);
      log.info(`Session expired (idle timeout): ${chatKey}`);
    }, IDLE_TIMEOUT_MS);
    timer.unref();
    idleTimers.set(chatKey, timer);
  }

  function destroySession(chatKey: string): boolean {
    const session = sessions.get(chatKey);
    if (!session) {
      return false;
    }

    if (session.activeProcess && !session.activeProcess.killed) {
      session.activeProcess.kill("SIGTERM");
      const proc = session.activeProcess;
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 3000);
    }

    sessions.delete(chatKey);
    const timer = idleTimers.get(chatKey);
    if (timer) {
      clearTimeout(timer);
      idleTimers.delete(chatKey);
    }
    return true;
  }

  function getOrCreateSession(chatKey: string, cwd: string): VibecodingSession {
    const existing = sessions.get(chatKey);
    if (existing) {
      return existing;
    }

    // Rate limit session creation per chat key
    const lastCreated = lastSessionCreation.get(chatKey) ?? 0;
    if (Date.now() - lastCreated < MIN_SESSION_INTERVAL_MS) {
      throw new Error("Rate limit: please wait before starting a new session.");
    }
    lastSessionCreation.set(chatKey, Date.now());

    if (sessions.size >= maxSessions) {
      // Evict oldest idle session
      let oldestKey: string | undefined;
      let oldestActivity = Infinity;
      for (const [key, s] of sessions) {
        if (s.activeProcess === null && s.lastActivityAt < oldestActivity) {
          oldestActivity = s.lastActivityAt;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        destroySession(oldestKey);
        log.info(`Evicted idle session to make room: ${oldestKey}`);
      } else {
        throw new Error(`Maximum concurrent sessions (${maxSessions}) reached. Use vibecoding /stop to end a session.`);
      }
    }

    const session: VibecodingSession = {
      sessionId: crypto.randomUUID(),
      chatKey,
      cwd,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      activeProcess: null,
    };
    sessions.set(chatKey, session);
    resetIdleTimer(chatKey);
    log.info(`New session created: ${chatKey} (cwd: ${cwd})`);
    return session;
  }

  async function handleCommand({ chatKey, prompt, sendChunk, textChunkLimit }: HandleCommandOpts): Promise<string> {
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return `Error: Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters.`;
    }

    const parsed = parseVibecodingCommand(prompt);

    if (parsed.kind === "error") {
      return `Error: ${parsed.message}`;
    }

    if (parsed.kind === "stop") {
      const stopped = destroySession(chatKey);
      return stopped
        ? "Vibecoding session stopped and process killed."
        : "No active vibecoding session for this chat.";
    }

    if (parsed.kind === "status") {
      const session = sessions.get(chatKey);
      if (!session) {
        return "No active vibecoding session for this chat.";
      }
      return formatSessionStatus(session);
    }

    // Prompt command
    if (!parsed.text) {
      return "Usage: vibecoding [--cwd <path>] <prompt>\n\nSubcommands: vibecoding /stop, vibecoding /status";
    }

    const existingSession = sessions.get(chatKey);
    const isResume = existingSession !== undefined;

    // Resolve cwd: first message sets it, follow-ups use existing
    let cwd: string;
    if (existingSession) {
      cwd = existingSession.cwd;
    } else {
      try {
        cwd = parsed.cwd ? await validateCwd(parsed.cwd, defaultCwd) : defaultCwd;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : "Invalid working directory"}`;
      }
    }

    let session: VibecodingSession;
    try {
      session = getOrCreateSession(chatKey, cwd);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : "Failed to create session"}`;
    }

    // If a process is already running, reject
    if (session.activeProcess && !session.activeProcess.killed) {
      return "A vibecoding process is already running for this session. Wait for it to finish or use vibecoding /stop.";
    }

    updateSession(sessions, chatKey, { lastActivityAt: Date.now() });
    resetIdleTimer(chatKey);

    try {
      const { process: child, result } = runClaude({
        prompt: parsed.text,
        sessionId: session.sessionId,
        isResume,
        cwd: session.cwd,
        timeoutMs: timeoutMs,
        onStdout: sendChunk,
        allowedTools,
      });

      updateSession(sessions, chatKey, { activeProcess: child });

      const output = await result;
      updateSession(sessions, chatKey, { activeProcess: null, lastActivityAt: Date.now() });
      resetIdleTimer(chatKey);

      if (!output.trim()) {
        return "[No output from Claude Code]";
      }

      // If there's a chunk limit, split the output
      if (textChunkLimit && textChunkLimit > 0 && output.length > textChunkLimit) {
        return chunkText(output, textChunkLimit).join("\n---\n");
      }

      return output;
    } catch (err) {
      updateSession(sessions, chatKey, { activeProcess: null });
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Vibecoding failed for ${chatKey}: ${message}`);
      return `Vibecoding error: ${message}`;
    }
  }

  function getSessionStatus(chatKey: string): VibecodingSessionStatus | undefined {
    const session = sessions.get(chatKey);
    if (!session) {
      return undefined;
    }
    return {
      sessionId: session.sessionId,
      cwd: session.cwd,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      isRunning: session.activeProcess !== null && !session.activeProcess.killed,
    };
  }

  function stopSession(chatKey: string): boolean {
    return destroySession(chatKey);
  }

  function cleanupAll(): void {
    for (const chatKey of [...sessions.keys()]) {
      destroySession(chatKey);
    }
    log.info("All vibecoding sessions cleaned up");
  }

  return {
    handleCommand,
    getSessionStatus,
    stopSession,
    cleanupAll,
    sessions,
  };
}
