/**
 * IPC Watcher for MicroClaw
 * Polls container IPC directories for messages and processes them
 */
import fs from "fs";
import path from "path";

import { DATA_DIR, IPC_POLL_INTERVAL } from "./config.js";
import { createLogger } from "../logging.js";
import type { MemorySearchManager } from "../memory/types.js";

const log = createLogger("ipc");

export interface IpcWatcherDeps {
  onMessage: (channelId: string, chatId: string | undefined, text: string) => void;
  memoryManager?: MemorySearchManager;
}

let watcherRunning = false;
let watcherTimeout: ReturnType<typeof setTimeout> | null = null;

export function startIpcWatcher(deps: IpcWatcherDeps): void {
  if (watcherRunning) return;
  watcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, "ipc");
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    if (!watcherRunning) return;

    try {
      let channelFolders: string[] = [];
      try {
        channelFolders = fs
          .readdirSync(ipcBaseDir)
          .filter((f) => {
            try {
              return fs.statSync(path.join(ipcBaseDir, f)).isDirectory();
            } catch {
              return false;
            }
          });
      } catch {
        // ipcBaseDir may not exist yet
      }

      for (const channelId of channelFolders) {
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
            const filePath = path.join(messagesDir, file);
            try {
              // Guard against symlink attacks from malicious containers
              const stat = fs.lstatSync(filePath);
              if (stat.isSymbolicLink()) {
                log.warn(`Skipping symlink in IPC messages: ${file}`);
                try { fs.unlinkSync(filePath); } catch { /* best-effort */ }
                continue;
              }
              const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

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
              // Move to errors directory
              const errorsDir = path.join(ipcBaseDir, "errors");
              fs.mkdirSync(errorsDir, { recursive: true });
              try {
                fs.renameSync(filePath, path.join(errorsDir, file));
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
            const filePath = path.join(tasksDir, file);
            try {
              // Guard against symlink attacks from malicious containers
              const taskStat = fs.lstatSync(filePath);
              if (taskStat.isSymbolicLink()) {
                log.warn(`Skipping symlink in IPC tasks: ${file}`);
                try { fs.unlinkSync(filePath); } catch { /* best-effort */ }
                continue;
              }
              const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

              if (
                data.type === "search_memory" &&
                typeof data.query === "string" &&
                data.query.length <= 1000
              ) {
                const limit = typeof data.limit === "number" && data.limit > 0 && data.limit <= 50
                  ? data.limit
                  : 5;
                const results = await deps.memoryManager.search({
                  query: data.query,
                  limit,
                });

                const resultFile = filePath.replace(/\.json$/, ".result.json");
                const tempPath = `${resultFile}.tmp`;
                fs.writeFileSync(
                  tempPath,
                  JSON.stringify({ results }, null, 2),
                );
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

    if (watcherRunning) {
      watcherTimeout = setTimeout(() => {
        processIpcFiles().catch((err) => {
          log.error(`IPC watcher fatal error: ${err instanceof Error ? err.message : String(err)}`);
          watcherRunning = false;
        });
      }, IPC_POLL_INTERVAL);
    }
  };

  processIpcFiles().catch((err) => {
    log.error(`IPC watcher fatal error: ${err instanceof Error ? err.message : String(err)}`);
    watcherRunning = false;
  });
  log.info("IPC watcher started");
}

export function stopIpcWatcher(): void {
  watcherRunning = false;
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
      // Strip newlines to prevent env variable injection
      const sanitized = value.replace(/[\r\n]/g, "");
      if (sanitized.length > 0) {
        lines.push(`${varName}=${sanitized}`);
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
