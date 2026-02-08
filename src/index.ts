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
import { loadSkills } from "./skills/loader.js";
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
import { CronService } from "./cron/service.js";
import { defaultCronJobsPath } from "./cron/store.js";
import { runCronIsolatedAgentTurn } from "./cron/isolated-agent.js";
import { appendCronRunLog, resolveCronRunLogPath } from "./cron/run-log.js";
import { createCronTool } from "./agent/cron-tool.js";
import { createShellTool, cleanupAllSessions } from "./agent/shell-tool.js";
import type { MemorySearchManager } from "./memory/types.js";
import type { AgentTool } from "./agent/types.js";
import type { SkillToolFactory } from "./skills/types.js";
import type { ChannelPlugin, GatewayInboundMessage } from "./channels/plugins/types.js";

const log = createLogger("main");

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

  log.info("Starting MicroClaw...");

  // 2. Load config and resolve all paths upfront
  const config = loadConfig();
  const paths = resolvePaths(config);
  const { dataDir } = paths;
  const port = resolvePort(config);
  const host = resolveHost(config);

  const provider = config.agent?.provider ?? "anthropic";

  // 3. Resolve auth credentials (only required for Anthropic provider)
  let auth: import("./infra/auth.js").AuthCredentials = { isOAuth: false };
  if (provider === "anthropic") {
    auth = resolveAuthCredentials();
    log.info(`Auth mode: ${auth.isOAuth ? "Claude Code OAuth" : "API key"}`);
  } else {
    log.info(`LLM provider: ${provider}`);
  }

  log.info(`Data directory: ${dataDir}`);

  // 4. Load skills
  const skillRegistry = await loadSkills({ config, skillsDir: paths.skillsDir });
  log.info(`Loaded ${skillRegistry.skills.length} skills`);
  for (const diag of skillRegistry.diagnostics) {
    if (diag.level === "error") {
      log.error(`Skill ${diag.skillId}: ${diag.message}`);
    } else {
      log.info(`Skill ${diag.skillId}: ${diag.message}`);
    }
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

  // 8. Adapt skill-registered tools to agent tool format
  const additionalTools: AgentTool[] = [];

  // Add canvas tool
  additionalTools.push(createCanvasTool({ webMonitor, canvasState }));
  log.info("Canvas tool registered");

  // Add shell command execution tool (skip in container mode where sandbox provides its own shell)
  if (!containerEnabled) {
    additionalTools.push(createShellTool({ cwd: paths.projectRoot, shellPath: paths.shellPath }));
    log.info("Shell tool registered");
  }

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

  const frozenConfig = structuredClone(config);
  Object.freeze(frozenConfig);

  for (const reg of skillRegistry.tools) {
    if ("factory" in reg.tool && (reg.tool as SkillToolFactory).factory) {
      // Factory tools need runtime context; skip for now
      continue;
    }
    const skillTool = reg.tool as import("./skills/types.js").AgentTool;
    if (typeof skillTool.name !== "string" || typeof skillTool.execute !== "function") {
      log.warn(`Skipping malformed skill tool from ${reg.skillId}`);
      continue;
    }
    additionalTools.push({
      name: skillTool.name,
      description: skillTool.description,
      input_schema: (skillTool.parameters && typeof skillTool.parameters === "object" && "type" in skillTool.parameters) ? skillTool.parameters : { type: "object", properties: {} },
      execute: (params, runtimeCtx) => skillTool.execute(params, {
        sessionKey: "",
        channelId: runtimeCtx?.channelId ?? "web",
        chatId: "",
        config: frozenConfig,
      }),
    });
  }

  // 9. Create agent (cron tool added after agent creation)
  const agent = createAgent({
    config,
    auth,
    memoryManager,
    containerEnabled,
    canvasEnabled: true,
    additionalTools: additionalTools.length > 0 ? additionalTools : undefined,
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
      memoryManager!.updateUserProfile(profileLlmClient)
        .catch((err) => {
          log.warn(`User profile extraction failed: ${formatError(err)}`);
        })
        .finally(() => { extractionInProgress = false; });
    };
    // Run once on startup (non-blocking)
    runProfileExtraction();
    // Schedule daily
    profileInterval = setInterval(runProfileExtraction, PROFILE_INTERVAL_MS);
    profileInterval.unref();
    log.info("User profile extraction scheduled (24h interval)");
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
      // For microclaw, system events are handled by sending through agent.chat
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
      // No-op for microclaw (no heartbeat system)
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

  // 9b. Start channel gateway lifecycles
  const activeGateways: Array<{ channelId: string; accountId: string; plugin: ChannelPlugin }> = [];
  const processingGatewayChats = new Set<string>();
  // Track recently sent outbound texts to avoid re-processing agent replies as new messages
  const recentOutboundTexts = new Map<string, Set<string>>();
  const OUTBOUND_ECHO_TTL_MS = 30_000;
  // Queue for gateway messages received while a chat is still processing
  const pendingGatewayMessages = new Map<string, Array<GatewayInboundMessage>>();

  for (const reg of skillRegistry.channels) {
    const plugin = reg.plugin as ChannelPlugin;
    if (!plugin.gateway?.startAccount) continue;

    const channelId = plugin.id;
    const isConfigured = plugin.config.isConfigured?.(config) ?? false;
    const isEnabled = plugin.config.isEnabled?.(config) ?? true;

    if (!isConfigured || !isEnabled) {
      log.info(`Gateway skipped for ${channelId}: configured=${isConfigured}, enabled=${isEnabled}`);
      continue;
    }

    const accountId = config.channels?.[channelId as keyof typeof config.channels]?.accountId ?? "default";

    const handleGatewayMessage = async (msg: GatewayInboundMessage): Promise<void> => {
      const chatKey = `${channelId}:${msg.chatId}`;
      const isFromSelf = msg.from === "me";

      // Broadcast to webchat clients so all messages appear in the channel view
      webMonitor.broadcast(JSON.stringify({
        type: "channel_message",
        channelId,
        from: msg.from,
        text: msg.text,
        timestamp: msg.timestamp,
        senderName: msg.senderName ?? msg.from,
        isFromSelf,
      }));

      // Detect outbound echoes: agent replies show up as is_from_me in chat.db
      if (isFromSelf) {
        const echoSet = recentOutboundTexts.get(msg.chatId);
        if (echoSet?.has(msg.text)) {
          echoSet.delete(msg.text);
          // Still persist the assistant side of the exchange
          if (memoryManager) {
            memoryManager.saveExchange({
              channelId,
              userMessage: "",
              assistantMessage: msg.text,
              timestamp: msg.timestamp,
            }).catch((err) => {
              log.warn(`Failed to persist outbound echo for ${channelId}: ${formatError(err)}`);
            });
          }
          return;
        }
      }

      // Per-chat concurrency guard with message queueing
      if (processingGatewayChats.has(chatKey)) {
        const queue = pendingGatewayMessages.get(chatKey) ?? [];
        if (queue.length < 5) { // cap queue to prevent unbounded growth
          pendingGatewayMessages.set(chatKey, [...queue, msg]);
        } else {
          log.warn(`Dropping message for ${chatKey}: queue full`);
        }
        return;
      }
      processingGatewayChats.add(chatKey);

      try {
        // Load recent chat history
        const historyMessages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> = [];
        if (memoryManager) {
          try {
            const history = await memoryManager.loadChatHistory({ channelId, limit: 50 });
            for (const h of history) {
              historyMessages.push({ role: h.role, content: h.content, timestamp: h.timestamp });
            }
          } catch {
            // History loading is non-fatal
          }
        }

        // Get agent response
        const response = await agent.chat({
          messages: [
            ...historyMessages,
            { role: "user", content: msg.text, timestamp: msg.timestamp },
          ],
          channelId,
        });

        // Send reply via outbound adapter
        if (response.text && plugin.outbound?.sendText) {
          // Track outbound text so we can filter the echo when it comes back via poll
          const MAX_ECHO_ENTRIES = 500;
          if (recentOutboundTexts.size > MAX_ECHO_ENTRIES) {
            // Clear oldest entries
            const keys = [...recentOutboundTexts.keys()];
            for (let i = 0; i < keys.length - MAX_ECHO_ENTRIES; i++) {
              recentOutboundTexts.delete(keys[i]);
            }
          }
          const echoSet = recentOutboundTexts.get(msg.chatId) ?? new Set<string>();
          echoSet.add(response.text);
          recentOutboundTexts.set(msg.chatId, echoSet);
          setTimeout(() => {
            echoSet.delete(response.text);
            if (echoSet.size === 0) recentOutboundTexts.delete(msg.chatId);
          }, OUTBOUND_ECHO_TTL_MS);

          await plugin.outbound.sendText({
            config,
            accountId,
            to: msg.chatId,
            text: response.text,
            chatType: msg.chatType,
          });

          // Broadcast agent reply to web UI so it appears in the channel view
          webMonitor.broadcast(JSON.stringify({
            type: "channel_message",
            channelId,
            from: "assistant",
            text: response.text,
            timestamp: Date.now(),
            senderName: "MicroClaw",
            isFromSelf: true,
          }));
        }

        // Persist exchange
        if (memoryManager) {
          memoryManager.saveExchange({
            channelId,
            userMessage: msg.text,
            assistantMessage: response.text,
            timestamp: msg.timestamp,
          }).catch((err) => {
            log.warn(`Failed to persist exchange for ${channelId}: ${formatError(err)}`);
          });
        }
      } catch (err) {
        log.error(`Gateway message handling failed for ${chatKey}: ${formatError(err)}`);
      } finally {
        processingGatewayChats.delete(chatKey);
        const queued = pendingGatewayMessages.get(chatKey);
        if (queued && queued.length > 0) {
          const [next, ...rest] = queued;
          if (rest.length === 0) {
            pendingGatewayMessages.delete(chatKey);
          } else {
            pendingGatewayMessages.set(chatKey, rest);
          }
          setImmediate(() => { handleGatewayMessage(next).catch((err) => {
            log.error(`Queued gateway message failed for ${chatKey}: ${formatError(err)}`);
          }); });
        }
      }
    };

    const onMessage = (msg: GatewayInboundMessage): Promise<void> => handleGatewayMessage(msg);

    try {
      await plugin.gateway.startAccount({
        config,
        accountId,
        account: undefined,
        onMessage,
      });
      activeGateways.push({ channelId, accountId, plugin });
      log.info(`Gateway started: ${channelId}`);
    } catch (err) {
      log.error(`Failed to start gateway for ${channelId}: ${formatError(err)}`);
    }
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

  // 11. Create web routes
  const app = createWebRoutes({
    config,
    agent,
    memoryManager,
    webMonitor,
    dataDir,
    cronService,
    cronStorePath,
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

    // Stop channel gateways (await all in parallel)
    await Promise.allSettled(
      activeGateways.map(async (gw) => {
        try {
          await gw.plugin.gateway?.stopAccount?.({ config, accountId: gw.accountId });
          log.info(`Gateway stopped: ${gw.channelId}`);
        } catch (err) {
          log.error(`Failed to stop gateway ${gw.channelId}: ${formatError(err)}`);
        }
      }),
    );

    // Clean up persistent shell sessions
    cleanupAllSessions();

    // Stop cron scheduler
    try {
      cronService.stop();
      log.info("Cron scheduler stopped");
    } catch (err) {
      log.error(`Failed to stop cron scheduler: ${formatError(err)}`);
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

  log.info(`MicroClaw running at http://${host}:${port}`);

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
