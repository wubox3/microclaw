import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MicroClawConfig } from "../config/types.js";
import type { MemorySearchManager } from "../memory/types.js";
import type { Agent } from "../agent/agent.js";
import type { WebMonitor } from "../channels/web/monitor.js";
import { listChatChannels } from "../channels/registry.js";
import { textToSpeech } from "../voice/tts.js";
import { loadVoiceWakeConfig, setVoiceWakeTriggers } from "../voice/voicewake.js";
import { createCanvasRoutes } from "../canvas-host/server.js";
import { createLogger } from "../logging.js";

const log = createLogger("web-routes");

export type WebAppDeps = {
  config: MicroClawConfig;
  agent: Agent;
  memoryManager?: MemorySearchManager;
  webMonitor: WebMonitor;
  dataDir: string;
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
    try {
      const results = await deps.memoryManager.search({
        query: body.query,
        limit,
      });
      return c.json({ success: true, data: results });
    } catch (err) {
      log.error(`Memory search failed: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "Memory search failed" }, 500);
    }
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
    const VALID_ROLES = new Set(["user", "assistant"]);
    const messages = body.messages.filter(
      (m: unknown): m is { role: string; content: string } =>
        typeof m === "object" && m !== null &&
        typeof (m as Record<string, unknown>).role === "string" &&
        VALID_ROLES.has((m as Record<string, unknown>).role as string) &&
        typeof (m as Record<string, unknown>).content === "string",
    );
    if (messages.length === 0) {
      return c.json({ success: false, error: "messages must contain valid {role, content} objects with role 'user' or 'assistant'" }, 400);
    }
    const timestamp = Date.now();
    const userText = messages[messages.length - 1]?.content ?? "";

    // REST clients send the full conversation in the request body,
    // so we do NOT also load DB history (that would duplicate messages).
    try {
      const response = await deps.agent.chat({
        messages: messages.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
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
    } catch (err) {
      log.error(`Chat request failed: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "Chat request failed" }, 500);
    }
  });

  app.get("/api/chat/history", async (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: true, data: [] });
    }

    const channelId = c.req.query("channelId") ?? "web";
    const limit = Math.max(1, Math.min(Number(c.req.query("limit")) || 50, 200));
    const beforeParam = c.req.query("before");
    const before = beforeParam !== undefined ? Number(beforeParam) : undefined;
    if (before !== undefined && (!Number.isFinite(before) || before < 0)) {
      return c.json({ success: false, error: "'before' must be a non-negative number" }, 400);
    }

    try {
      const messages = await deps.memoryManager.loadChatHistory({
        channelId,
        limit,
        before,
      });
      return c.json({ success: true, data: messages });
    } catch (err) {
      log.error(`Failed to load chat history: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "Failed to load chat history" }, 500);
    }
  });

  // Voice wake word endpoints
  app.get("/api/voicewake", async (c) => {
    try {
      const cfg = await loadVoiceWakeConfig(deps.dataDir);
      return c.json({ success: true, data: { triggers: cfg.triggers } });
    } catch (err) {
      log.error(`Failed to load voice wake config: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "Failed to load voice wake config" }, 500);
    }
  });

  app.post("/api/voicewake", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }
    if (!Array.isArray(body.triggers)) {
      return c.json({ success: false, error: "triggers must be a string array" }, 400);
    }
    const triggers = body.triggers.filter(
      (t: unknown): t is string => typeof t === "string" && t.trim().length > 0,
    );
    if (triggers.length === 0) {
      return c.json({ success: false, error: "triggers must contain at least one non-empty string" }, 400);
    }
    try {
      const cfg = await setVoiceWakeTriggers(triggers, deps.dataDir);
      return c.json({ success: true, data: { triggers: cfg.triggers } });
    } catch (err) {
      log.error(`Failed to set voice wake triggers: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "Failed to set voice wake triggers" }, 500);
    }
  });

  // TTS endpoint
  app.post("/api/tts", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }
    if (typeof body.text !== "string" || body.text.trim().length === 0) {
      return c.json({ success: false, error: "text must be a non-empty string" }, 400);
    }
    const VALID_VOICES = new Set(["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"]);
    let voice: string | undefined;
    if (typeof body.voice === "string" && body.voice.trim().length > 0) {
      const trimmed = body.voice.trim();
      if (!VALID_VOICES.has(trimmed)) {
        return c.json({ success: false, error: `Invalid voice. Must be one of: ${[...VALID_VOICES].join(", ")}` }, 400);
      }
      voice = trimmed;
    }

    try {
      const result = await textToSpeech({
        text: body.text.trim(),
        config: deps.config,
        voice: voice || undefined,
      });

      if (!result.success || !result.audioBuffer) {
        return c.json({ success: false, error: result.error ?? "TTS conversion failed" }, 500);
      }

      return new Response(new Uint8Array(result.audioBuffer), {
        status: 200,
        headers: {
          "Content-Type": result.contentType ?? "audio/mpeg",
          "Content-Length": String(result.audioBuffer.length),
          "Cache-Control": "no-cache",
        },
      });
    } catch (err) {
      log.error(`TTS request failed: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "TTS request failed" }, 500);
    }
  });

  // Mount canvas routes
  const canvasApp = createCanvasRoutes(deps.dataDir);
  app.route("/canvas", canvasApp);

  // Static files (read once at startup, not per-request)
  const safeReadFile = (filePath: string): string => {
    try {
      return readFileSync(filePath, "utf-8");
    } catch (err) {
      log.warn(`Static file not found: ${filePath}`);
      return "";
    }
  };
  const cssContent = safeReadFile(resolve(publicDir, "styles.css"));
  const jsContent = safeReadFile(resolve(publicDir, "app.js"));
  const voiceJsContent = safeReadFile(resolve(publicDir, "voice.js"));
  const canvasJsContent = safeReadFile(resolve(publicDir, "canvas.js"));
  const htmlContent = safeReadFile(resolve(publicDir, "index.html"));

  app.get("/styles.css", (c) => {
    return c.text(cssContent, 200, { "Content-Type": "text/css" });
  });

  app.get("/app.js", (c) => {
    return c.text(jsContent, 200, { "Content-Type": "application/javascript" });
  });

  app.get("/voice.js", (c) => {
    return c.text(voiceJsContent, 200, { "Content-Type": "application/javascript" });
  });

  app.get("/canvas.js", (c) => {
    return c.text(canvasJsContent, 200, { "Content-Type": "application/javascript" });
  });

  app.get("/", (c) => {
    return c.html(htmlContent);
  });

  return app;
}
