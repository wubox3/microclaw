/**
 * IPC Watcher for EClaw
 * Polls container IPC directories for messages and processes them
 */
import fs from "fs";
import path from "path";

import { DATA_DIR, IPC_POLL_INTERVAL } from "./config.js";
import { createLogger } from "../logging.js";
import type { MemorySearchManager } from "../memory/types.js";

const log = createLogger("ipc");

const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
if (fs.constants.O_NOFOLLOW === undefined) {
  log.warn("O_NOFOLLOW is not available on this platform; symlink protection is degraded");
}

export interface IpcWatcherDeps {
  onMessage: (channelId: string, chatId: string | undefined, text: string) => void;
  memoryManager?: MemorySearchManager;
}

let watcherRunning = false;
let watcherTimeout: ReturnType<typeof setTimeout> | null = null;
let watcherAbort: AbortController | null = null;

export function startIpcWatcher(deps: IpcWatcherDeps): void {
  if (watcherRunning) return;
  watcherRunning = true;
  watcherAbort = new AbortController();

  const ipcBaseDir = path.join(DATA_DIR, "ipc");
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    if (!watcherRunning) return;
    if (watcherAbort?.signal.aborted) return;

    try {
      let channelFolders: string[] = [];
      try {
        channelFolders = fs
          .readdirSync(ipcBaseDir)
          .filter((f) => {
            if (!/^[a-zA-Z0-9_-]+$/.test(f)) return false;
            try {
              const stat = fs.lstatSync(path.join(ipcBaseDir, f));
              return stat.isDirectory() && !stat.isSymbolicLink();
            } catch {
              return false;
            }
          });
      } catch {
        // ipcBaseDir may not exist yet
      }

      for (const channelId of channelFolders) {
        if (watcherAbort?.signal.aborted) return;

        const messagesDir = path.join(ipcBaseDir, channelId, "messages");
        const tasksDir = path.join(ipcBaseDir, channelId, "tasks");

        // Process messages
        if (fs.existsSync(messagesDir)) {
          let messageFiles: string[] = [];
          try {
            messageFiles = fs
              .readdirSync(messagesDir)
              .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"));
          } catch {
            // Directory might have been removed
          }

          for (const file of messageFiles) {
            if (watcherAbort?.signal.aborted) return;

            const filePath = path.join(messagesDir, file);
            try {
              // Atomically prevent symlink following with O_NOFOLLOW
              let fd: number;
              try {
                fd = fs.openSync(filePath, fs.constants.O_RDONLY | O_NOFOLLOW);
              } catch {
                log.warn(`Skipping symlink or unreadable IPC message: ${file}`);
                try { fs.unlinkSync(filePath); } catch { /* best-effort */ }
                continue;
              }
              let rawData: string;
              try {
                // Reject oversized files to prevent OOM from malicious containers
                const MAX_IPC_FILE_SIZE = 1024 * 1024; // 1 MB
                const stat = fs.fstatSync(fd);
                if (stat.size > MAX_IPC_FILE_SIZE) {
                  throw new Error(`IPC message file exceeds ${MAX_IPC_FILE_SIZE} bytes (${stat.size})`);
                }
                rawData = fs.readFileSync(fd, "utf-8");
              } finally {
                fs.closeSync(fd);
              }
              const data = JSON.parse(rawData);

              if (data.type === "message") {
                // Always use folder-derived channelId, never trust container data
                deps.onMessage(
                  channelId,
                  data.chatId,
                  typeof data.text === "string" ? data.text.slice(0, 50000) : "",
                );
              }

              fs.unlinkSync(filePath);
            } catch (err) {
              log.warn(
                `Failed to process IPC message ${file}: ${err instanceof Error ? err.message : String(err)}`,
              );
              // Move to errors directory (capped at 100 files)
              const errorsDir = path.join(ipcBaseDir, "errors");
              fs.mkdirSync(errorsDir, { recursive: true });
              try {
                // Evict oldest error files if at capacity
                const MAX_ERROR_FILES = 100;
                const errorFiles = fs.readdirSync(errorsDir)
                  .filter((f) => f.endsWith(".json"))
                  .map(f => ({ name: f, mtime: fs.statSync(path.join(errorsDir, f)).mtimeMs }))
                  .sort((a, b) => a.mtime - b.mtime)
                  .map(f => f.name);
                if (errorFiles.length >= MAX_ERROR_FILES) {
                  for (const old of errorFiles.slice(0, errorFiles.length - MAX_ERROR_FILES + 1)) {
                    try { fs.unlinkSync(path.join(errorsDir, old)); } catch { /* best-effort */ }
                  }
                }
                fs.renameSync(filePath, path.join(errorsDir, `${channelId}-${file}`));
              } catch {
                try {
                  fs.unlinkSync(filePath);
                } catch {
                  // Ignore cleanup errors
                }
              }
            }
          }
        }

        // Process task results (memory search requests from container)
        if (fs.existsSync(tasksDir) && deps.memoryManager) {
          let taskFiles: string[] = [];
          try {
            taskFiles = fs
              .readdirSync(tasksDir)
              .filter(
                (f) =>
                  f.endsWith(".json") &&
                  !f.endsWith(".tmp") &&
                  !f.endsWith(".result.json"),
              );
          } catch {
            // Directory might have been removed
          }

          for (const file of taskFiles) {
            if (watcherAbort?.signal.aborted) return;

            const filePath = path.join(tasksDir, file);
            try {
              // Atomically prevent symlink following with O_NOFOLLOW
              let taskFd: number;
              try {
                taskFd = fs.openSync(filePath, fs.constants.O_RDONLY | O_NOFOLLOW);
              } catch {
                log.warn(`Skipping symlink or unreadable IPC task: ${file}`);
                try { fs.unlinkSync(filePath); } catch { /* best-effort */ }
                continue;
              }
              let taskRawData: string;
              try {
                // Reject oversized files to prevent OOM from malicious containers
                const MAX_IPC_TASK_SIZE = 256 * 1024; // 256 KB
                const taskStat = fs.fstatSync(taskFd);
                if (taskStat.size > MAX_IPC_TASK_SIZE) {
                  throw new Error(`IPC task file exceeds ${MAX_IPC_TASK_SIZE} bytes (${taskStat.size})`);
                }
                taskRawData = fs.readFileSync(taskFd, "utf-8");
              } finally {
                fs.closeSync(taskFd);
              }
              const data = JSON.parse(taskRawData);

              if (
                data.type === "search_memory" &&
                typeof data.query === "string" &&
                data.query.length <= 1000
              ) {
                const limit = typeof data.limit === "number" && data.limit > 0 && data.limit <= 50
                  ? data.limit
                  : 5;
                if (watcherAbort?.signal.aborted) return;

                const results = await deps.memoryManager.search({
                  query: data.query,
                  limit,
                });

                if (watcherAbort?.signal.aborted) return;

                const resultFile = filePath.replace(/\.json$/, ".result.json");
                const tempPath = `${resultFile}.tmp`;
                // Use O_WRONLY | O_CREAT | O_EXCL to avoid following symlinks
                const fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
                try {
                  fs.writeSync(fd, JSON.stringify({ results }, null, 2));
                } finally {
                  fs.closeSync(fd);
                }
                fs.renameSync(tempPath, resultFile);
              }

              fs.unlinkSync(filePath);
            } catch (err) {
              log.warn(
                `Failed to process IPC task ${file}: ${err instanceof Error ? err.message : String(err)}`,
              );
              try {
                fs.unlinkSync(filePath);
              } catch {
                // Ignore cleanup errors
              }
            }
          }
        }
      }
    } catch (err) {
      log.error(
        `IPC watcher error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (watcherRunning && !watcherAbort?.signal.aborted) {
      watcherTimeout = setTimeout(scheduleNext, IPC_POLL_INTERVAL);
    }
  };

  const scheduleNext = () => {
    processIpcFiles().catch((err) => {
      log.error(`IPC watcher error: ${err instanceof Error ? err.message : String(err)}`);
      // Always reschedule so the watcher never dies silently
      if (watcherRunning && !watcherAbort?.signal.aborted) {
        watcherTimeout = setTimeout(scheduleNext, IPC_POLL_INTERVAL * 2);
      }
    });
  };

  scheduleNext();
  log.info("IPC watcher started");
}

export function stopIpcWatcher(): void {
  watcherRunning = false;
  watcherAbort?.abort();
  watcherAbort = null;
  if (watcherTimeout !== null) {
    clearTimeout(watcherTimeout);
    watcherTimeout = null;
  }
  log.info("IPC watcher stopped");
}

const ENV_FILE_PATH = path.join(DATA_DIR, "env", "env");

/**
 * Write filtered environment variables for container consumption.
 * Only exposes auth-related variables needed by the Claude Agent SDK.
 */
export function writeFilteredEnvFile(): void {
  const envDir = path.join(DATA_DIR, "env");
  fs.mkdirSync(envDir, { recursive: true });

  const allowedVars = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"];
  const lines: string[] = [];

  for (const varName of allowedVars) {
    const value = process.env[varName];
    if (value) {
      // Strip newlines and null bytes to prevent env variable injection
      const sanitized = value.replace(/[\r\n\0]/g, "");
      if (sanitized.length > 0) {
        // Quote with single quotes and escape embedded single quotes
        const quoted = sanitized.replace(/'/g, "'\\''");
        lines.push(`${varName}='${quoted}'`);
      }
    }
  }

  if (lines.length > 0) {
    const tempPath = `${ENV_FILE_PATH}.tmp`;
    try {
      fs.writeFileSync(tempPath, lines.join("\n") + "\n", {
        mode: 0o600,
      });
      fs.renameSync(tempPath, ENV_FILE_PATH);
    } catch (err) {
      log.error(`Failed to write filtered env file: ${err instanceof Error ? err.message : String(err)}`);
      try { fs.unlinkSync(tempPath); } catch { /* cleanup best-effort */ }
    }
  }
}

/**
 * Remove the filtered env file on shutdown to avoid leaving credentials on disk.
 */
export function removeFilteredEnvFile(): void {
  try {
    if (fs.existsSync(ENV_FILE_PATH)) {
      fs.unlinkSync(ENV_FILE_PATH);
      log.info("Removed filtered env file");
    }
  } catch (err) {
    log.warn(`Failed to remove env file: ${err instanceof Error ? err.message : String(err)}`);
  }
}
