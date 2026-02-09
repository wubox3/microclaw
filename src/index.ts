import { serve } from "@hono/node-server";
import { WebSocket, WebSocketServer } from "ws";
import crypto from "node:crypto";
import { execSync } from "child_process";
// unlinkSync removed (unused import)
import { loadDotenv } from "./infra/dotenv.js";
import { isDev } from "./infra/env.js";
import { resolveAuthCredentials } from "./infra/auth.js";
import { formatError } from "./infra/errors.js";
import { createLogger } from "./logging.js";
import { loadConfig, resolvePort, resolveHost } from "./config/config.js";
import { resolvePaths } from "./config/paths.js";
import { buildWorkspaceSkillSnapshot } from "./skills/workspace.js";
import { ensureSkillsWatcher } from "./skills/refresh.js";
import { createMemoryManager } from "./memory/manager.js";
import { createAgent } from "./agent/agent.js";
import { createLlmClient } from "./agent/create-client.js";
import { createWebRoutes } from "./web/routes.js";
import { createWebMonitor } from "./channels/web/monitor.js";
import { startIpcWatcher, stopIpcWatcher, writeFilteredEnvFile, removeFilteredEnvFile } from "./container/ipc.js";
import { createCanvasState } from "./canvas-host/types.js";
import { createCanvasTool } from "./agent/canvas-tool.js";
import { startBrowserServer, stopBrowserServer } from "./browser/server.js";
import { createBrowserTool } from "./browser/browser-tool.js";
import { startWhatsAppGateway } from "./channels/whatsapp/gateway.js";
import { startTelegramGateway } from "./channels/telegram/gateway.js";
import { startSignalGateway } from "./channels/signal/gateway.js";
import { CronService } from "./cron/service.js";
import { defaultCronJobsPath } from "./cron/store.js";
import { AsapRunner } from "./jobs/runner.js";
import { runCronIsolatedAgentTurn } from "./cron/isolated-agent.js";
import { appendCronRunLog, resolveCronRunLogPath } from "./cron/run-log.js";
import { createCronTool } from "./agent/cron-tool.js";
import type { MemorySearchManager } from "./memory/types.js";
import type { AgentTool } from "./agent/types.js";
import { createVibecodingManager } from "./agent/vibecoding-tool.js";

const log = createLogger("main");

/** Escape text for safe HTML display in canvas. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Format vibecoding output as canvas HTML. */
function vibecodingCanvasHtml(prompt: string, output: string): string {
  return `<div style="font-family:monospace;padding:16px;background:#1e1e2e;color:#cdd6f4;height:100%;overflow:auto;box-sizing:border-box"><h3 style="color:#89b4fa;margin:0 0 8px">Vibecoding</h3><p style="color:#a6adc8;margin:0 0 12px;font-size:13px">${escapeHtml(prompt)}</p><pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-size:13px;line-height:1.5">${escapeHtml(output)}</pre></div>`;
}

/** Safely send JSON to a WebSocket, handling race between readyState check and send. */
function safeSend(ws: WebSocket, data: unknown): void {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  } catch {
    // Connection closed between readyState check and send
  }
}

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const cleanupFns: (() => Promise<void> | void)[] = [];

async function main(): Promise<void> {

  // 1. Load environment
  loadDotenv();

  log.info("Starting EClaw...");

  // 2. Load config and resolve all paths upfront
  const config = loadConfig();
  const paths = resolvePaths(config);
  const { dataDir } = paths;
  const port = resolvePort(config);
  const host = resolveHost(config);

  // Initialize vibecoding session manager
  const vibecodingManager = createVibecodingManager({
    defaultCwd: paths.projectRoot,
    allowedTools: [
      "Bash(npm:*)",
      "Bash(npx:*)",
      "Bash(node:*)",
      "Bash(pnpm:*)",
      "Bash(yarn:*)",
      "Bash(tsc:*)",
      "Bash(git:*)",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
    ],
  });
  cleanupFns.push(() => { vibecodingManager.cleanupAll(); });

  const provider = config.agent?.provider ?? "anthropic";

  // 3. Resolve auth credentials (only required for Anthropic provider)
  let auth: import("./infra/auth.js").AuthCredentials = { isOAuth: false };
  if (provider === "anthropic") {
    auth = await resolveAuthCredentials();
    log.info(`Auth mode: ${auth.isOAuth ? "Claude Code OAuth" : "API key"}`);
  } else {
    log.info(`LLM provider: ${provider}`);
  }

  log.info(`Data directory: ${dataDir}`);

  // 4. Load skills (SKILL.md-based system)
  const skillSnapshot = buildWorkspaceSkillSnapshot(process.cwd(), { config });
  log.info(`Loaded ${skillSnapshot.skills.length} skills`);
  for (const skill of skillSnapshot.skills) {
    log.info(`Skill: ${skill.name}`);
  }

  // 5. Initialize memory system
  let memoryManager: MemorySearchManager | undefined;
  if (config.memory?.enabled !== false) {
    try {
      memoryManager = createMemoryManager({ config, dataDir, auth });
      cleanupFns.push(() => memoryManager?.close());
      log.info("Memory system initialized");
    } catch (err) {
      log.warn(`Memory system failed to initialize: ${formatError(err)}`);
    }
  }

  // 6. Check Docker availability for container mode (opt-in only)
  const dockerAvailable = config.container?.enabled === true ? isDockerAvailable() : false;
  const containerEnabled = config.container?.enabled === true && dockerAvailable;

  if (containerEnabled) {
    log.info("Container mode: enabled");
    writeFilteredEnvFile();
  } else if (config.container?.enabled === true && !dockerAvailable) {
    log.warn("Container mode: requested but Docker not found, falling back to direct mode");
  } else {
    log.info("Container mode: disabled");
  }

  // 7. Create web monitor and canvas state (needed before agent for canvas tool)
  const webMonitor = createWebMonitor();
  const canvasState = createCanvasState();

  // 8. Register additional agent tools (canvas, browser)
  const additionalTools: AgentTool[] = [];

  // Add canvas tool
  additionalTools.push(createCanvasTool({ webMonitor, canvasState }));
  log.info("Canvas tool registered");

  // Start browser control server
  if (config.browser?.enabled !== false) {
    try {
      const browserState = await startBrowserServer({
        browserConfig: config.browser,
      });
      if (browserState) {
        additionalTools.push(createBrowserTool());
        cleanupFns.push(() => stopBrowserServer());
        log.info(`Browser control on http://127.0.0.1:${browserState.port}/`);
      }
    } catch (err) {
      log.warn(`Browser server failed to start: ${formatError(err)}`);
    }
  }

  // 9. Create agent (cron tool added after agent creation)
  const agent = createAgent({
    config,
    auth,
    memoryManager,
    containerEnabled,
    canvasEnabled: true,
    additionalTools: additionalTools.length > 0 ? additionalTools : undefined,
    skillsPrompt: skillSnapshot.prompt || undefined,
  });
  log.info("Agent initialized");

  // 9-profile. Schedule user profile extraction (non-blocking)
  const PROFILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  let profileInterval: ReturnType<typeof setInterval> | undefined;
  if (memoryManager) {
    const profileLlmClient = createLlmClient({ config, auth });
    let extractionInProgress = false;
    const runProfileExtraction = () => {
      if (extractionInProgress) return;
      extractionInProgress = true;
      const mgr = memoryManager!;
      const run = async () => {
        try {
          await mgr.updateUserProfile(profileLlmClient).catch((err) => {
            log.warn(`User profile extraction failed: ${formatError(err)}`);
          });
          await mgr.updateProgrammingSkills(profileLlmClient).catch((err) => {
            log.warn(`Programming skills extraction failed: ${formatError(err)}`);
          });
          await mgr.updateProgrammingPlanning(profileLlmClient).catch((err) => {
            log.warn(`Programming planning extraction failed: ${formatError(err)}`);
          });
          await mgr.updateEventPlanning(profileLlmClient).catch((err) => {
            log.warn(`Event planning extraction failed: ${formatError(err)}`);
          });
          await mgr.updateWorkflow(profileLlmClient).catch((err) => {
            log.warn(`Workflow extraction failed: ${formatError(err)}`);
          });
          await mgr.updateTasks(profileLlmClient).catch((err) => {
            log.warn(`Tasks extraction failed: ${formatError(err)}`);
          });
        } finally {
          extractionInProgress = false;
        }
      };
      run().catch((err) => {
        log.error(`Extraction run failed unexpectedly: ${formatError(err)}`);
      });
    };
    // Run once on startup (non-blocking)
    runProfileExtraction();
    // Schedule daily
    profileInterval = setInterval(runProfileExtraction, PROFILE_INTERVAL_MS);
    profileInterval.unref();
    log.info("User profile + programming skills + programming planning + event planning + workflow + tasks extraction scheduled (24h interval)");
  }

  // 9a. Build and start cron scheduler
  const cronEnabled = config.cron?.enabled !== false;
  const cronStorePath = defaultCronJobsPath(paths.cronStorePath);
  const cronService = new CronService({
    log: {
      debug: (obj, msg) => log.debug(msg ?? JSON.stringify(obj)),
      info: (obj, msg) => log.info(msg ?? JSON.stringify(obj)),
      warn: (obj, msg) => log.warn(msg ?? JSON.stringify(obj)),
      error: (obj, msg) => log.error(msg ?? JSON.stringify(obj)),
    },
    storePath: cronStorePath,
    cronEnabled,
    enqueueSystemEvent: (text, opts) => {
      // For eclaw, system events are handled by sending through agent.chat
      log.info(`Cron system event${opts?.agentId ? ` [${opts.agentId}]` : ""}: ${text.slice(0, 100)}`);
      // Broadcast to web UI
      webMonitor.broadcast(JSON.stringify({
        type: "channel_message",
        channelId: "cron",
        from: "system",
        text,
        timestamp: Date.now(),
        senderName: "Cron Scheduler",
        isFromSelf: false,
      }));
    },
    requestHeartbeatNow: () => {
      // No-op for eclaw (no heartbeat system)
    },
    runIsolatedAgentJob: async (params) => {
      const result = await runCronIsolatedAgentTurn({
        agent,
        job: params.job,
        message: params.message,
        webMonitor,
      });
      // Run log is appended by the onEvent handler below to avoid double-logging
      return result;
    },
    onEvent: (evt) => {
      try {
        if (evt.action === "finished") {
          log.info(`Cron job ${evt.jobId} finished: ${evt.status ?? "unknown"}`);
          const logPath = resolveCronRunLogPath({ storePath: cronStorePath, jobId: evt.jobId });
          appendCronRunLog(logPath, {
            ts: Date.now(),
            jobId: evt.jobId,
            action: "finished",
            status: evt.status,
            error: evt.error,
            summary: evt.summary,
            runAtMs: evt.runAtMs,
            durationMs: evt.durationMs,
            nextRunAtMs: evt.nextRunAtMs,
          }).catch(() => {});
        }
      } catch (err) {
        log.error(`Cron onEvent error: ${formatError(err)}`);
      }
    },
  });

  try {
    await cronService.start();
    cleanupFns.push(() => cronService.stop());
    log.info(`Cron scheduler ${cronEnabled ? "started" : "disabled"}`);
  } catch (err) {
    log.error(`Cron scheduler failed to start: ${formatError(err)}`);
  }

  // Register cron tool with agent (via addTool so it's available after agent creation)
  agent.addTool(createCronTool({ cronService, storePath: cronStorePath }));
  log.info("Cron tool registered");

  // 9c. Start WhatsApp gateway (wacli-based)
  const whatsAppHandle = startWhatsAppGateway({ config, agent, webMonitor, memoryManager });
  if (whatsAppHandle) {
    cleanupFns.push(() => { whatsAppHandle.stop(); });
  }

  // 9d. Start Telegram gateway (polling-based)
  const telegramHandle = startTelegramGateway({ config, agent, webMonitor, memoryManager });
  if (telegramHandle) {
    cleanupFns.push(() => { telegramHandle.stop(); });
  }

  // 9e. Start Signal gateway (polling-based)
  const signalHandle = startSignalGateway({ config, agent, webMonitor, memoryManager });
  if (signalHandle) {
    cleanupFns.push(() => { signalHandle.stop(); });
  }

  // 9b. Start skills file watcher
  if (config.skills?.load?.watch !== false) {
    ensureSkillsWatcher({ workspaceDir: process.cwd(), config });
    log.info("Skills file watcher started");
  }

  // 10. Start IPC watcher if container mode active
  if (containerEnabled) {
    cleanupFns.push(() => { stopIpcWatcher(); removeFilteredEnvFile(); });
    startIpcWatcher({
      onMessage: (channelId, _chatId, text) => {
        // Deliver IPC messages to WebSocket clients
        for (const [clientId, client] of webMonitor.clients) {
          if (client.ws.readyState !== WebSocket.OPEN) {
            continue;
          }
          try {
            client.ws.send(
              JSON.stringify({
                type: "message",
                text,
                timestamp: Date.now(),
                source: "container",
                channelId,
              }),
            );
          } catch (err) {
            log.warn(`Failed to deliver IPC message to ${clientId}: ${formatError(err)}`);
          }
        }
      },
      memoryManager,
    });
  }

  // 10a. Create ASAP job runner
  const asapRunner = new AsapRunner({
    storePath: paths.asapStorePath,
    enqueueSystemEvent: (text) => {
      log.info(`ASAP system event: ${text.slice(0, 100)}`);
      webMonitor.broadcast(JSON.stringify({
        type: "channel_message",
        channelId: "asap",
        from: "system",
        text,
        timestamp: Date.now(),
        senderName: "ASAP Queue",
        isFromSelf: false,
      }));
    },
  });
  log.info("ASAP job runner initialized");

  // 11. Create web routes
  const app = createWebRoutes({
    config,
    agent,
    memoryManager,
    webMonitor,
    dataDir,
    cronService,
    cronStorePath,
    vibecodingManager,
    asapRunner,
  });

  // 12. Start server
  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  // 13a. Graceful shutdown -- close SQLite to checkpoint WAL
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("Shutting down...");

    // Force exit after 15 seconds if graceful close hangs (allows SQLite WAL checkpoint)
    setTimeout(() => {
      log.warn("Forced shutdown after timeout");
      process.exit(1);
    }, 15000).unref();

    // Close memory manager first to ensure SQLite WAL checkpoint completes
    if (memoryManager) {
      try {
        await memoryManager.close();
        log.info("Memory database closed");
      } catch (err) {
        log.error(`Failed to close memory database: ${formatError(err)}`);
      }
    }

    // Stop cron scheduler
    try {
      cronService.stop();
      log.info("Cron scheduler stopped");
    } catch (err) {
      log.error(`Failed to stop cron scheduler: ${formatError(err)}`);
    }

    // Stop WhatsApp gateway
    if (whatsAppHandle) {
      whatsAppHandle.stop();
    }

    if (profileInterval) {
      clearInterval(profileInterval);
    }
    stopBrowserServer().catch(() => {});
    if (containerEnabled) {
      stopIpcWatcher();
      removeFilteredEnvFile();
    }
    // Close WebSocket server and terminate all client connections
    wss.clients.forEach((client) => {
      client.terminate();
    });
    wss.close(() => {
      server.close(() => {
        process.exit(0);
      });
    });
  };

  // 13b. Attach WebSocket
  const wss = new WebSocketServer({
    server: server as unknown as import("http").Server,
    path: "/ws",
    verifyClient: ({ req }: { req: import("http").IncomingMessage }) => {
      const ALLOWED_HOSTS = ["localhost", "127.0.0.1", "::1"];
      // Validate Host header to prevent DNS rebinding attacks
      const requestHost = req.headers.host;
      if (requestHost) {
        const hostWithoutPort = requestHost.replace(/:\d+$/, "");
        if (!ALLOWED_HOSTS.includes(hostWithoutPort)) {
          return false;
        }
      }
      const origin = req.headers.origin;
      if (origin) {
        try {
          const url = new URL(origin);
          if (!ALLOWED_HOSTS.includes(url.hostname)) {
            return false;
          }
        } catch {
          return false;
        }
      }
      // Reject connections that have neither Host nor Origin header
      if (!requestHost && !origin) {
        return false;
      }
      return true;
    },
  });

  // Register signal handlers after wss is initialized to avoid temporal dead zone
  process.on("SIGTERM", () => { shutdown().catch((err) => log.error(`Shutdown error: ${formatError(err)}`)); });
  process.on("SIGINT", () => { shutdown().catch((err) => log.error(`Shutdown error: ${formatError(err)}`)); });

  wss.on("connection", (ws) => {
    const clientId = `web-${crypto.randomUUID()}`;
    webMonitor.addClient(clientId, ws);
    log.info(`WebSocket client connected: ${clientId}`);

    // Send memory status on connect
    if (memoryManager) {
      Promise.all([
        memoryManager.getStatus(),
        memoryManager.getRecordCounts(),
      ]).then(([status, counts]) => {
        safeSend(ws, {
          type: "memory_status",
          status: `${status.provider}/${status.model} (${status.dimensions}d)`,
          counts,
        });
      }).catch(() => {
        // ignore
      });
    }

    // Send container mode status
    safeSend(ws, {
      type: "container_status",
      enabled: containerEnabled,
    });
  });

  // 14. Handle WebSocket messages -> agent
  const processingClients = new Set<string>();
  webMonitor.onMessage(async (clientId, message) => {
    const client = webMonitor.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Prevent concurrent message processing per client
    if (processingClients.has(clientId)) {
      safeSend(client.ws, { 
        type: "error", 
        message: "Still processing your previous message. Please wait.",
        retryable: true 
      });
      return;
    }
    processingClients.add(clientId);

    try {
      // Send typing indicator
      safeSend(client.ws, { type: "typing" });

      // Resolve the channel for this message (default to "web")
      const resolvedChannelId = message.channelId ?? "web";

      // Validate channelId to prevent injection
      if (!/^[a-zA-Z0-9_-]+$/.test(resolvedChannelId)) {
        safeSend(client.ws, { type: "error", message: "Invalid channelId" });
        return;
      }

      // Intercept vibecoding commands before agent processing
      if (message.text.startsWith("vibecoding ")) {
        const vibeChatKey = `web:${clientId}`;

        // Show canvas and set loading state
        canvasState.update((s) => ({ ...s, visible: true }));
        safeSend(client.ws, { type: "canvas_present" });
        safeSend(client.ws, {
          type: "canvas_update",
          html: vibecodingCanvasHtml(message.text, "Running..."),
        });

        let streamedOutput = "";
        const output = await vibecodingManager.handleCommand({
          chatKey: vibeChatKey,
          prompt: message.text,
          sendChunk: (chunk) => {
            streamedOutput += chunk;
            safeSend(client.ws, {
              type: "vibecoding_chunk",
              text: chunk,
              timestamp: Date.now(),
              channelId: resolvedChannelId,
            });
            // Update canvas with accumulated output
            safeSend(client.ws, {
              type: "canvas_update",
              html: vibecodingCanvasHtml(message.text, streamedOutput),
            });
          },
        });

        // Final canvas update with complete output
        const canvasHtml = vibecodingCanvasHtml(message.text, output);
        canvasState.update((s) => ({ ...s, lastHtml: canvasHtml }));
        safeSend(client.ws, { type: "canvas_update", html: canvasHtml });

        safeSend(client.ws, {
          type: "message",
          text: output,
          timestamp: Date.now(),
          channelId: resolvedChannelId,
        });

        // Persist vibecoding exchange
        if (memoryManager) {
          memoryManager.saveExchange({
            channelId: resolvedChannelId,
            userMessage: message.text,
            assistantMessage: output,
            timestamp: message.timestamp,
          }).catch((err) => {
            log.warn(`Failed to persist vibecoding exchange for ${resolvedChannelId}: ${formatError(err)}`);
          });
        }
        return;
      }

      // Load recent chat history for conversation context
      const historyMessages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> = [];
      if (memoryManager) {
        try {
          const history = await memoryManager.loadChatHistory({ channelId: resolvedChannelId, limit: 50 });
          for (const msg of history) {
            historyMessages.push({ role: msg.role, content: msg.content, timestamp: msg.timestamp });
          }
        } catch {
          // History loading is non-fatal
        }
      }

      // Get agent response with history + current message
      const response = await agent.chat({
        messages: [
          ...historyMessages,
          { role: "user", content: message.text, timestamp: message.timestamp },
        ],
        channelId: resolvedChannelId,
      });

      // Send response
      safeSend(client.ws, {
        type: "message",
        text: response.text,
        timestamp: Date.now(),
        channelId: resolvedChannelId,
      });

      // Persist exchange (non-fatal)
      if (memoryManager) {
        memoryManager.saveExchange({
          channelId: resolvedChannelId,
          userMessage: message.text,
          assistantMessage: response.text,
          timestamp: message.timestamp,
        }).catch((err) => {
          log.warn(`Failed to persist exchange for ${resolvedChannelId}: ${formatError(err)}`);
        });
      }
    } catch (err) {
      log.error(`Chat failed for ${clientId}: ${formatError(err)}`);
      safeSend(client.ws, {
        type: "error",
        message: "An internal error occurred",
      });
    } finally {
      processingClients.delete(clientId);
    }
  });

  // 15. Handle canvas actions -> agent (with concurrency guard and history context)
  webMonitor.onCanvasAction(async (clientId, action) => {
    // Reuse same concurrency guard as regular messages
    if (processingClients.has(clientId)) {
      return;
    }
    processingClients.add(clientId);

    const safeAction = String(action.action).slice(0, 100);
    const safeComponentId = action.componentId ? String(action.componentId).slice(0, 100) : undefined;
    const safeValue = action.value !== undefined ? JSON.stringify(action.value).slice(0, 1000) : undefined;
    const actionText = `[Canvas Action] User ${safeAction}${safeComponentId ? ` on "${safeComponentId}"` : ""}${safeValue ? ` with value: ${safeValue}` : ""}`;

    try {
      // Load conversation history for context
      const historyMessages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> = [];
      if (memoryManager) {
        try {
          const history = await memoryManager.loadChatHistory({ channelId: "web", limit: 50 });
          for (const msg of history) {
            historyMessages.push({ role: msg.role, content: msg.content, timestamp: msg.timestamp });
          }
        } catch {
          // Non-fatal
        }
      }

      const now = Date.now();
      const response = await agent.chat({
        messages: [
          ...historyMessages,
          { role: "user", content: actionText, timestamp: now },
        ],
        channelId: "web",
      });

      if (response.text) {
        // Send response only to the originating client, not all clients
        const originClient = webMonitor.clients.get(clientId);
        if (originClient) {
          safeSend(originClient.ws, {
            type: "message",
            text: response.text,
            timestamp: Date.now(),
          });
        }

        // Persist exchange (non-fatal)
        if (memoryManager) {
          memoryManager.saveExchange({
            channelId: "web",
            userMessage: actionText,
            assistantMessage: response.text,
            timestamp: now,
          }).catch((err) => {
            log.warn(`Failed to persist canvas exchange: ${formatError(err)}`);
          });
        }
      }
    } catch (err) {
      log.error(`Canvas action handling failed: ${formatError(err)}`);
    } finally {
      processingClients.delete(clientId);
    }
  });

  log.info(`EClaw running at http://${host}:${port}`);

  if (isDev()) {
    log.info("Development mode enabled");
  }
}

// Handle unhandled errors
process.on("unhandledRejection", (err) => {
  log.error(`Unhandled rejection: ${formatError(err)}`);
});

process.on("uncaughtException", (err) => {
  log.error(`Uncaught exception: ${formatError(err)}`);
  // Best-effort credential cleanup (no-op if file doesn't exist)
  try { removeFilteredEnvFile(); } catch {}
  process.exit(1);
});

main().catch(async (err) => {
  log.error(`Fatal error: ${formatError(err)}`);
  for (const cleanup of cleanupFns.reverse()) {
    try { await cleanup(); } catch { /* best-effort */ }
  }
  process.exit(1);
});
