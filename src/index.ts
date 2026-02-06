import { serve } from "@hono/node-server";
import { WebSocket, WebSocketServer } from "ws";
import { execSync } from "child_process";
import { loadDotenv } from "./infra/dotenv.js";
import { isDev } from "./infra/env.js";
import { resolveAuthCredentials } from "./infra/auth.js";
import { formatError } from "./infra/errors.js";
import { createLogger } from "./logging.js";
import { loadConfig, resolveDataDir, resolvePort, resolveHost } from "./config/config.js";
import { loadSkills } from "./skills/loader.js";
import { createMemoryManager } from "./memory/manager.js";
import { createAgent } from "./agent/agent.js";
import { createWebRoutes } from "./web/routes.js";
import { createWebMonitor } from "./channels/web/monitor.js";
import { startIpcWatcher, stopIpcWatcher, writeFilteredEnvFile, removeFilteredEnvFile } from "./container/ipc.js";
import { createCanvasState } from "./canvas-host/types.js";
import { createCanvasTool } from "./agent/canvas-tool.js";
import { startBrowserServer, stopBrowserServer } from "./browser/server.js";
import { createBrowserTool } from "./browser/browser-tool.js";
import type { MemorySearchManager } from "./memory/types.js";
import type { AgentTool } from "./agent/types.js";
import type { SkillToolFactory } from "./skills/types.js";

const log = createLogger("main");

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  // 1. Load environment
  loadDotenv();

  log.info("Starting MicroClaw...");

  // 2. Load config (before auth, so provider selection is known)
  const config = loadConfig();
  const dataDir = resolveDataDir(config);
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
  const skillRegistry = await loadSkills({ config });
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

  // Start browser control server
  if (config.browser?.enabled !== false) {
    try {
      const browserState = await startBrowserServer({
        browserConfig: config.browser,
      });
      if (browserState) {
        additionalTools.push(createBrowserTool());
        log.info(`Browser control on http://127.0.0.1:${browserState.port}/`);
      }
    } catch (err) {
      log.warn(`Browser server failed to start: ${formatError(err)}`);
    }
  }

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
      input_schema: skillTool.parameters ?? { type: "object", properties: {} },
      execute: (params, runtimeCtx) => skillTool.execute(params, {
        sessionKey: "",
        channelId: runtimeCtx?.channelId ?? "web",
        chatId: "",
        config,
      }),
    });
  }

  // 9. Create agent
  const agent = createAgent({
    config,
    auth,
    memoryManager,
    containerEnabled,
    canvasEnabled: true,
    additionalTools: additionalTools.length > 0 ? additionalTools : undefined,
  });
  log.info("Agent initialized");

  // 10. Start IPC watcher if container mode active
  if (containerEnabled) {
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
  });

  // 12. Start server
  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  // 13a. Graceful shutdown -- close SQLite to checkpoint WAL
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("Shutting down...");
    stopBrowserServer().catch(() => {});
    if (containerEnabled) {
      stopIpcWatcher();
      removeFilteredEnvFile();
    }
    if (memoryManager) {
      try {
        memoryManager.close();
        log.info("Memory database closed");
      } catch (err) {
        log.error(`Failed to close memory database: ${formatError(err)}`);
      }
    }
    server.close(() => {
      process.exit(0);
    });
    // Force exit after 5 seconds if graceful close hangs
    setTimeout(() => {
      log.warn("Forced shutdown after timeout");
      process.exit(1);
    }, 5000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // 13b. Attach WebSocket
  const wss = new WebSocketServer({
    server: server as unknown as import("http").Server,
    path: "/ws",
  });
  let clientIdCounter = 0;

  wss.on("connection", (ws) => {
    const clientId = `web-${++clientIdCounter}`;
    webMonitor.addClient(clientId, ws);
    log.info(`WebSocket client connected: ${clientId}`);

    // Send memory status on connect
    if (memoryManager) {
      memoryManager.getStatus().then((status) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "memory_status",
            status: `${status.provider}/${status.model} (${status.dimensions}d)`,
          }));
        }
      }).catch(() => {
        // ignore
      });
    }

    // Send container mode status
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "container_status",
        enabled: containerEnabled,
      }));
    }
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
      client.ws.send(JSON.stringify({ type: "error", message: "Please wait for the current response" }));
      return;
    }
    processingClients.add(clientId);

    try {
      // Send typing indicator
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: "typing" }));
      }

      // Load recent chat history for conversation context
      const historyMessages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> = [];
      if (memoryManager) {
        try {
          const history = await memoryManager.loadChatHistory({ channelId: "web", limit: 20 });
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
        channelId: "web",
      });

      // Send response
      if (client.ws.readyState === WebSocket.OPEN) {
        const responseTimestamp = Date.now();
        client.ws.send(JSON.stringify({
          type: "message",
          text: response.text,
          timestamp: responseTimestamp,
        }));
      }

      // Persist exchange (non-fatal)
      if (memoryManager) {
        memoryManager.saveExchange({
          channelId: "web",
          userMessage: message.text,
          assistantMessage: response.text,
          timestamp: message.timestamp,
        }).catch(() => {
          // Best-effort persistence
        });
      }
    } catch (err) {
      log.error(`Chat failed for ${clientId}: ${formatError(err)}`);
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
          type: "error",
          message: "An internal error occurred",
        }));
      }
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

    const actionText = `[Canvas Action] User ${action.action}${action.componentId ? ` on "${action.componentId}"` : ""}${action.value !== undefined ? ` with value: ${JSON.stringify(action.value)}` : ""}`;

    try {
      // Load conversation history for context
      const historyMessages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> = [];
      if (memoryManager) {
        try {
          const history = await memoryManager.loadChatHistory({ channelId: "web", limit: 20 });
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
        if (originClient && originClient.ws.readyState === WebSocket.OPEN) {
          originClient.ws.send(JSON.stringify({
            type: "message",
            text: response.text,
            timestamp: Date.now(),
          }));
        }

        // Persist exchange (non-fatal)
        if (memoryManager) {
          memoryManager.saveExchange({
            channelId: "web",
            userMessage: actionText,
            assistantMessage: response.text,
            timestamp: now,
          }).catch(() => {
            // Best-effort persistence
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
  removeFilteredEnvFile();
  process.exit(1);
});

main().catch((err) => {
  log.error(`Failed to start: ${formatError(err)}`);
  process.exit(1);
});
