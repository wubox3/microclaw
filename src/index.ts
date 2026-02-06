import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
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
import { startIpcWatcher, writeFilteredEnvFile } from "./container/ipc.js";
import type { MemorySearchManager } from "./memory/types.js";

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

  // 7. Create agent
  const agent = createAgent({
    config,
    auth,
    memoryManager,
    containerEnabled,
  });
  log.info("Agent initialized");

  // 8. Create web monitor
  const webMonitor = createWebMonitor();

  // 9. Start IPC watcher if container mode active
  if (containerEnabled) {
    startIpcWatcher({
      onMessage: (channelId, _chatId, text) => {
        // Deliver IPC messages to WebSocket clients
        for (const [clientId, client] of webMonitor.clients) {
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

  // 10. Create web routes
  const app = createWebRoutes({
    config,
    agent,
    memoryManager,
    webMonitor,
  });

  // 11. Start server
  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  // 12. Attach WebSocket
  const wss = new WebSocketServer({ server: server as unknown as import("http").Server });
  let clientIdCounter = 0;

  wss.on("connection", (ws) => {
    const clientId = `web-${++clientIdCounter}`;
    webMonitor.addClient(clientId, ws);
    log.info(`WebSocket client connected: ${clientId}`);

    // Send memory status on connect
    if (memoryManager) {
      memoryManager.getStatus().then((status) => {
        ws.send(JSON.stringify({
          type: "memory_status",
          status: `${status.provider}/${status.model} (${status.dimensions}d)`,
        }));
      }).catch(() => {
        // ignore
      });
    }

    // Send container mode status
    ws.send(JSON.stringify({
      type: "container_status",
      enabled: containerEnabled,
    }));
  });

  // 13. Handle WebSocket messages -> agent
  webMonitor.onMessage(async (clientId, message) => {
    const client = webMonitor.clients.get(clientId);
    if (!client) {
      return;
    }

    try {
      // Send typing indicator
      client.ws.send(JSON.stringify({ type: "typing" }));

      // Get agent response
      const response = await agent.chat({
        messages: [{ role: "user", content: message.text, timestamp: message.timestamp }],
        channelId: "web",
      });

      // Send response
      client.ws.send(JSON.stringify({
        type: "message",
        text: response.text,
        timestamp: Date.now(),
      }));
    } catch (err) {
      client.ws.send(JSON.stringify({
        type: "error",
        message: formatError(err),
      }));
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
  process.exit(1);
});

main().catch((err) => {
  log.error(`Failed to start: ${formatError(err)}`);
  process.exit(1);
});
