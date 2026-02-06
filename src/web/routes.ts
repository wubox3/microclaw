import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MicroClawConfig } from "../config/types.js";
import type { MemorySearchManager } from "../memory/types.js";
import type { Agent } from "../agent/agent.js";
import type { WebMonitor } from "../channels/web/monitor.js";
import { listChatChannels } from "../channels/registry.js";

export type WebAppDeps = {
  config: MicroClawConfig;
  agent: Agent;
  memoryManager?: MemorySearchManager;
  webMonitor: WebMonitor;
};

export function createWebRoutes(deps: WebAppDeps): Hono {
  const app = new Hono();
  const publicDir = resolve(import.meta.dirname, "public");

  // API routes
  app.get("/api/channels", (c) => {
    const channels = listChatChannels();
    return c.json({ success: true, data: channels });
  });

  app.get("/api/memory/status", async (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: true, data: { ready: false, reason: "Memory not configured" } });
    }
    const status = await deps.memoryManager.getStatus();
    return c.json({ success: true, data: status });
  });

  app.post("/api/memory/search", async (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: false, error: "Memory not configured" }, 503);
    }
    const body = await c.req.json();
    const results = await deps.memoryManager.search({
      query: body.query,
      limit: body.limit,
    });
    return c.json({ success: true, data: results });
  });

  app.post("/api/chat", async (c) => {
    const body = await c.req.json();
    const messages = body.messages ?? [];
    const timestamp = Date.now();
    const userText = messages.length > 0 ? messages[messages.length - 1]?.content ?? "" : "";

    const response = await deps.agent.chat({
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
        timestamp,
      })),
      channelId: "web",
    });

    // Persist the exchange (non-fatal)
    if (deps.memoryManager && userText) {
      try {
        await deps.memoryManager.saveExchange({
          channelId: "web",
          userMessage: userText,
          assistantMessage: response.text,
          timestamp,
        });
      } catch {
        // Best-effort persistence
      }
    }

    return c.json({ success: true, data: { text: response.text } });
  });

  app.get("/api/chat/history", async (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: true, data: [] });
    }

    const channelId = c.req.query("channelId") ?? "web";
    const limit = Math.max(1, Math.min(Number(c.req.query("limit")) || 50, 200));
    const beforeParam = c.req.query("before");
    const before = beforeParam ? Number(beforeParam) : undefined;

    try {
      const messages = await deps.memoryManager.loadChatHistory({
        channelId,
        limit,
        before,
      });
      return c.json({ success: true, data: messages });
    } catch {
      return c.json({ success: false, error: "Failed to load chat history" }, 500);
    }
  });

  // Static files
  app.get("/styles.css", (c) => {
    const css = readFileSync(resolve(publicDir, "styles.css"), "utf-8");
    return c.text(css, 200, { "Content-Type": "text/css" });
  });

  app.get("/app.js", (c) => {
    const js = readFileSync(resolve(publicDir, "app.js"), "utf-8");
    return c.text(js, 200, { "Content-Type": "application/javascript" });
  });

  app.get("/", (c) => {
    const html = readFileSync(resolve(publicDir, "index.html"), "utf-8");
    return c.html(html);
  });

  return app;
}
