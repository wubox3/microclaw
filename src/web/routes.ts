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
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }
    if (typeof body.query !== "string" || body.query.trim().length === 0) {
      return c.json({ success: false, error: "query must be a non-empty string" }, 400);
    }
    const limit = typeof body.limit === "number" && body.limit > 0 && body.limit <= 100
      ? Math.floor(body.limit)
      : 10;
    const results = await deps.memoryManager.search({
      query: body.query,
      limit,
    });
    return c.json({ success: true, data: results });
  });

  app.post("/api/chat", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ success: false, error: "messages must be a non-empty array" }, 400);
    }
    const messages = body.messages.filter(
      (m: unknown): m is { role: string; content: string } =>
        typeof m === "object" && m !== null &&
        typeof (m as Record<string, unknown>).role === "string" &&
        typeof (m as Record<string, unknown>).content === "string",
    );
    if (messages.length === 0) {
      return c.json({ success: false, error: "messages must contain valid {role, content} objects" }, 400);
    }
    const timestamp = Date.now();
    const userText = messages[messages.length - 1]?.content ?? "";

    // Load recent chat history for conversation context
    const historyMessages: Array<{ role: string; content: string; timestamp: number }> = [];
    if (deps.memoryManager) {
      try {
        const history = await deps.memoryManager.loadChatHistory({ channelId: "web", limit: 20 });
        for (const msg of history) {
          historyMessages.push({ role: msg.role, content: msg.content, timestamp: msg.timestamp });
        }
      } catch {
        // History loading is non-fatal
      }
    }

    const response = await deps.agent.chat({
      messages: [
        ...historyMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content, timestamp: m.timestamp })),
        ...messages.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
          timestamp,
        })),
      ],
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
