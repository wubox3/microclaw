import { Hono } from "hono";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path, { resolve, basename } from "node:path";
import type { EClawConfig } from "../config/types.js";
import type { MemorySearchManager } from "../memory/types.js";
import type { Agent } from "../agent/agent.js";
import type { WebMonitor } from "../channels/web/monitor.js";
import type { CronService } from "../cron/service.js";
import type { VibecodingManager } from "../agent/vibecoding-tool.js";
import type { AsapRunner } from "../jobs/runner.js";
import { normalizeCronJobCreate, normalizeCronJobPatch } from "../cron/normalize.js";
import { readCronRunLogEntries, resolveCronRunLogPath } from "../cron/run-log.js";
import { projectFutureRuns } from "../cron/calendar.js";
import { listChatChannels } from "../channels/registry.js";
import { textToSpeech, resolveTtsConfig } from "../voice/tts.js";
import { loadVoiceWakeConfig, setVoiceWakeTriggers } from "../voice/voicewake.js";
import { createCanvasRoutes } from "../canvas-host/server.js";
import { createLogger } from "../logging.js";
import { z } from "zod";

const log = createLogger("web-routes");

const stringArraySchema = z.array(z.string().max(200)).max(20).default([]);

const workflowSchema = z.object({
  decompositionPatterns: stringArraySchema,
  taskSizingPreferences: stringArraySchema,
  prioritizationApproach: stringArraySchema,
  sequencingPatterns: stringArraySchema,
  dependencyHandling: stringArraySchema,
  estimationStyle: stringArraySchema,
  toolsAndProcesses: stringArraySchema,
  workflowInsights: stringArraySchema,
  lastUpdated: z.string().optional(),
});

const tasksSchema = z.object({
  activeTasks: stringArraySchema,
  completedTasks: stringArraySchema,
  blockedTasks: stringArraySchema,
  upcomingTasks: stringArraySchema,
  currentGoals: stringArraySchema,
  projectContext: stringArraySchema,
  deadlines: stringArraySchema,
  taskInsights: stringArraySchema,
  lastUpdated: z.string().optional(),
});

const optStr = z.string().max(200).optional();
const userProfileSchema = z.object({
  name: optStr, location: optStr, timezone: optStr, occupation: optStr, communicationStyle: optStr,
  interests: stringArraySchema, preferences: stringArraySchema, favoriteFoods: stringArraySchema,
  restaurants: stringArraySchema, coffeePlaces: stringArraySchema, clubs: stringArraySchema,
  shoppingPlaces: stringArraySchema, workPlaces: stringArraySchema, dailyPlaces: stringArraySchema,
  exerciseRoutes: stringArraySchema, keyFacts: stringArraySchema,
  lastUpdated: z.string().optional(),
});

const programmingSkillsSchema = z.object({
  languages: stringArraySchema, frameworks: stringArraySchema, architecturePatterns: stringArraySchema,
  codingStylePreferences: stringArraySchema, testingApproach: stringArraySchema,
  toolsAndLibraries: stringArraySchema, approvedPatterns: stringArraySchema,
  buildAndDeployment: stringArraySchema, editorAndEnvironment: stringArraySchema,
  keyInsights: stringArraySchema, lastUpdated: z.string().optional(),
});

const programmingPlanningSchema = z.object({
  structurePreferences: stringArraySchema, detailLevelPreferences: stringArraySchema,
  valuedPlanElements: stringArraySchema, architectureApproaches: stringArraySchema,
  scopePreferences: stringArraySchema, presentationFormat: stringArraySchema,
  approvedPlanPatterns: stringArraySchema, discardedReasons: stringArraySchema,
  planningInsights: stringArraySchema, lastUpdated: z.string().optional(),
});

const eventPlanningSchema = z.object({
  preferredTimes: stringArraySchema, preferredDays: stringArraySchema,
  recurringSchedules: stringArraySchema, venuePreferences: stringArraySchema,
  calendarHabits: stringArraySchema, planningStyle: stringArraySchema,
  eventTypes: stringArraySchema, schedulingInsights: stringArraySchema,
  lastUpdated: z.string().optional(),
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function vibecodingCanvasHtml(prompt: string, output: string): string {
  return `<div style="font-family:monospace;padding:16px;background:#1e1e2e;color:#cdd6f4;height:100%;overflow:auto;box-sizing:border-box"><h3 style="color:#89b4fa;margin:0 0 8px">Vibecoding</h3><p style="color:#a6adc8;margin:0 0 12px;font-size:13px">${escapeHtml(prompt)}</p><pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-size:13px;line-height:1.5">${escapeHtml(output)}</pre></div>`;
}

const safeErrorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error) {
    // Strip file paths and stack traces
    return err.message.replace(/\/[^\s]+/g, "[path]").slice(0, 200);
  }
  return fallback;
};

export type WebAppDeps = {
  config: EClawConfig;
  agent: Agent;
  memoryManager?: MemorySearchManager;
  webMonitor: WebMonitor;
  dataDir: string;
  cronService?: CronService;
  cronStorePath?: string;
  vibecodingManager?: VibecodingManager;
  asapRunner?: AsapRunner;
};

export function createWebRoutes(deps: WebAppDeps): Hono {
  const app = new Hono();
  const publicDir = resolve(import.meta.dirname, "public");

  // CSRF protection: validate Origin header on all state-mutating requests
  const STATE_MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  app.use("*", async (c, next) => {
    if (STATE_MUTATING_METHODS.has(c.req.method)) {
      const origin = c.req.header("Origin");
      if (!origin) {
        return c.json({ success: false, error: "CSRF: missing origin header" }, 403);
      }
      try {
        const url = new URL(origin);
        const validHosts = ["localhost", "127.0.0.1", "::1"];
        if (!validHosts.includes(url.hostname)) {
          return c.json({ success: false, error: "CSRF: invalid origin" }, 403);
        }
        // Also validate port to prevent cross-port CSRF from other local services
        const hostHeader = c.req.header("Host") ?? "";
        const [hostName, hostPort] = hostHeader.split(":");
        const expectedPort = hostPort ?? "";
        const originPort = url.port || (url.protocol === "https:" ? "443" : "80");
        // Always validate port - when Host has no port, compare against origin's default
        if (expectedPort) {
          if (originPort !== expectedPort) {
            return c.json({ success: false, error: "CSRF: origin port mismatch" }, 403);
          }
        } else {
          // Host has no port - only allow if Origin also uses default port
          const originUsesDefault = (url.protocol === "https:" && (originPort === "443" || !url.port)) ||
            (url.protocol === "http:" && (originPort === "80" || !url.port));
          if (!originUsesDefault) {
            return c.json({ success: false, error: "CSRF: origin port mismatch" }, 403);
          }
        }
      } catch {
        return c.json({ success: false, error: "CSRF: malformed origin" }, 403);
      }
    }
    await next();
  });

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
    try {
      const counts = await deps.memoryManager.getRecordCounts();
      return c.json({ success: true, data: { ...status, counts } });
    } catch {
      return c.json({ success: true, data: status });
    }
  });

  // Memory profile/skills/planning CRUD
  app.get("/api/memory/profile", (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: false, error: "Memory not configured" }, 503);
    }
    const profile = deps.memoryManager.getUserProfile();
    return c.json({ success: true, data: profile ?? null });
  });

  app.put("/api/memory/profile", async (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: false, error: "Memory not configured" }, 503);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }
    const parsed = userProfileSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: `Validation failed: ${parsed.error.message}` }, 400);
    }
    try {
      const profile: import("../memory/types.js").UserProfile = {
        ...parsed.data,
        lastUpdated: new Date().toISOString(),
      };
      deps.memoryManager.saveUserProfile(profile);
      return c.json({ success: true, data: deps.memoryManager.getUserProfile() });
    } catch (err) {
      log.error(`Failed to save user profile: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "Failed to save user profile" }, 500);
    }
  });

  app.get("/api/memory/skills", (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: false, error: "Memory not configured" }, 503);
    }
    const skills = deps.memoryManager.getProgrammingSkills();
    return c.json({ success: true, data: skills ?? null });
  });

  app.put("/api/memory/skills", async (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: false, error: "Memory not configured" }, 503);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }
    const parsed = programmingSkillsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: `Validation failed: ${parsed.error.message}` }, 400);
    }
    try {
      const skills: import("../memory/types.js").ProgrammingSkills = {
        ...parsed.data,
        lastUpdated: new Date().toISOString(),
      };
      deps.memoryManager.saveProgrammingSkills(skills);
      return c.json({ success: true, data: deps.memoryManager.getProgrammingSkills() });
    } catch (err) {
      log.error(`Failed to save programming skills: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "Failed to save programming skills" }, 500);
    }
  });

  app.get("/api/memory/programming-planning", (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: false, error: "Memory not configured" }, 503);
    }
    const planning = deps.memoryManager.getProgrammingPlanning();
    return c.json({ success: true, data: planning ?? null });
  });

  app.put("/api/memory/programming-planning", async (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: false, error: "Memory not configured" }, 503);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }
    const parsed = programmingPlanningSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: `Validation failed: ${parsed.error.message}` }, 400);
    }
    try {
      const planning: import("../memory/types.js").ProgrammingPlanning = {
        ...parsed.data,
        lastUpdated: new Date().toISOString(),
      };
      deps.memoryManager.saveProgrammingPlanning(planning);
      return c.json({ success: true, data: deps.memoryManager.getProgrammingPlanning() });
    } catch (err) {
      log.error(`Failed to save programming planning: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "Failed to save programming planning" }, 500);
    }
  });

  app.get("/api/memory/event-planning", (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: false, error: "Memory not configured" }, 503);
    }
    const planning = deps.memoryManager.getEventPlanning();
    return c.json({ success: true, data: planning ?? null });
  });

  app.put("/api/memory/event-planning", async (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: false, error: "Memory not configured" }, 503);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }
    const parsed = eventPlanningSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: `Validation failed: ${parsed.error.message}` }, 400);
    }
    try {
      const planning: import("../memory/types.js").EventPlanning = {
        ...parsed.data,
        lastUpdated: new Date().toISOString(),
      };
      deps.memoryManager.saveEventPlanning(planning);
      return c.json({ success: true, data: deps.memoryManager.getEventPlanning() });
    } catch (err) {
      log.error(`Failed to save event planning: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "Failed to save event planning" }, 500);
    }
  });

  app.get("/api/memory/workflow", (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: false, error: "Memory not configured" }, 503);
    }
    const workflow = deps.memoryManager.getWorkflow();
    return c.json({ success: true, data: workflow ?? null });
  });

  app.put("/api/memory/workflow", async (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: false, error: "Memory not configured" }, 503);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }
    const parsed = workflowSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: `Validation failed: ${parsed.error.message}` }, 400);
    }
    try {
      const workflow: import("../memory/types.js").Workflow = {
        ...parsed.data,
        lastUpdated: new Date().toISOString(),
      };
      deps.memoryManager.saveWorkflow(workflow);
      return c.json({ success: true, data: deps.memoryManager.getWorkflow() });
    } catch (err) {
      log.error(`Failed to save workflow: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "Failed to save workflow" }, 500);
    }
  });

  app.get("/api/memory/tasks", (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: false, error: "Memory not configured" }, 503);
    }
    const tasks = deps.memoryManager.getTasks();
    return c.json({ success: true, data: tasks ?? null });
  });

  app.put("/api/memory/tasks", async (c) => {
    if (!deps.memoryManager) {
      return c.json({ success: false, error: "Memory not configured" }, 503);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }
    const parsed = tasksSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: `Validation failed: ${parsed.error.message}` }, 400);
    }
    try {
      const tasks: import("../memory/types.js").Tasks = {
        ...parsed.data,
        lastUpdated: new Date().toISOString(),
      };
      deps.memoryManager.saveTasks(tasks);
      return c.json({ success: true, data: deps.memoryManager.getTasks() });
    } catch (err) {
      log.error(`Failed to save tasks: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "Failed to save tasks" }, 500);
    }
  });

  // GCC version control endpoints
  const GCC_VALID_TYPES = new Set(["programming_skills", "programming_planning", "event_planning", "workflow", "tasks"]);

  app.get("/api/memory/gcc/:type/log", (c) => {
    if (!deps.memoryManager?.gccStore) {
      return c.json({ success: false, error: "GCC not available" }, 503);
    }
    const memoryType = c.req.param("type");
    if (!GCC_VALID_TYPES.has(memoryType)) {
      return c.json({ success: false, error: "Invalid memory type" }, 400);
    }
    const branch = c.req.query("branch") ?? "main";
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.max(1, Math.min(Number(limitParam) || 50, 500)) : 50;
    try {
      const entries = deps.memoryManager.gccStore.log(
        memoryType as import("../memory/gcc-types.js").GccMemoryType,
        branch,
        limit,
      );
      return c.json({ success: true, data: entries });
    } catch (err) {
      log.error(`GCC log failed: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "Failed to get GCC log" }, 500);
    }
  });

  app.get("/api/memory/gcc/:type/branches", (c) => {
    if (!deps.memoryManager?.gccStore) {
      return c.json({ success: false, error: "GCC not available" }, 503);
    }
    const memoryType = c.req.param("type");
    if (!GCC_VALID_TYPES.has(memoryType)) {
      return c.json({ success: false, error: "Invalid memory type" }, 400);
    }
    try {
      const branches = deps.memoryManager.gccStore.listBranches(
        memoryType as import("../memory/gcc-types.js").GccMemoryType,
      );
      return c.json({ success: true, data: branches });
    } catch (err) {
      log.error(`GCC branches failed: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: "Failed to list branches" }, 500);
    }
  });

  app.post("/api/memory/gcc/:type/rollback", async (c) => {
    if (!deps.memoryManager?.gccStore) {
      return c.json({ success: false, error: "GCC not available" }, 503);
    }
    const memoryType = c.req.param("type");
    if (!GCC_VALID_TYPES.has(memoryType)) {
      return c.json({ success: false, error: "Invalid memory type" }, 400);
    }
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }
    if (typeof body.hash !== "string" || body.hash.trim().length === 0) {
      return c.json({ success: false, error: "hash must be a non-empty string" }, 400);
    }
    try {
      const commit = deps.memoryManager.gccStore.rollback(
        memoryType as import("../memory/gcc-types.js").GccMemoryType,
        body.hash,
      );
      return c.json({ success: true, data: commit });
    } catch (err) {
      log.error(`GCC rollback failed: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ success: false, error: safeErrorMessage(err, "Failed to rollback") }, 400);
    }
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

    // Intercept vibecoding commands
    if (deps.vibecodingManager && userText.startsWith("vibecoding ")) {
      try {
        // Show canvas with loading state
        deps.webMonitor.broadcast(JSON.stringify({ type: "canvas_present" }));
        deps.webMonitor.broadcast(JSON.stringify({
          type: "canvas_update",
          html: vibecodingCanvasHtml(userText, "Running..."),
        }));

        const output = await deps.vibecodingManager.handleCommand({
          chatKey: "web:rest",
          prompt: userText,
        });

        // Update canvas with final output
        deps.webMonitor.broadcast(JSON.stringify({
          type: "canvas_update",
          html: vibecodingCanvasHtml(userText, output),
        }));

        return c.json({ success: true, data: { text: output } });
      } catch (err) {
        log.error(`Vibecoding request failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: "Vibecoding request failed" }, 500);
      }
    }

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
    if (!/^[a-zA-Z0-9_-]+$/.test(channelId)) {
      return c.json({ success: false, error: "Invalid channelId" }, 400);
    }
    const limit = Math.max(1, Math.min(Number(c.req.query("limit")) || 50, 200));
    const beforeParam = c.req.query("before");
    const before = beforeParam !== undefined && beforeParam !== "" ? Number(beforeParam) : undefined;
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

  // Sound effects: serve custom .mp3 overrides from dataDir/sounds/
  const ALLOWED_SOUND_NAMES = new Set(["wake", "listen", "send", "error", "talk-start", "talk-end"]);

  // Preflight: tell client which custom sounds are available (avoids blind 404s)
  app.get("/api/sounds/available", (c) => {
    const soundsDir = resolve(deps.dataDir, "sounds");
    if (!existsSync(soundsDir)) {
      return c.json({ sounds: [] });
    }
    try {
      const files = readdirSync(soundsDir);
      const available = files
        .filter((f) => f.endsWith(".mp3"))
        .map((f) => basename(f, ".mp3"))
        .filter((name) => ALLOWED_SOUND_NAMES.has(name));
      return c.json({ sounds: available });
    } catch {
      return c.json({ sounds: [] });
    }
  });

  app.get("/sounds/:name", (c) => {
    const raw = c.req.param("name").replace(/\.mp3$/i, "");
    if (!ALLOWED_SOUND_NAMES.has(raw)) {
      return c.text("Not found", 404);
    }
    const soundsDir = resolve(deps.dataDir, "sounds");
    const soundPath = resolve(soundsDir, raw + ".mp3");
    const rel = path.relative(soundsDir, soundPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return c.json({ success: false, error: "Invalid sound name" }, 400);
    }
    if (!existsSync(soundPath)) {
      return c.text("Not found", 404);
    }
    try {
      const buf = readFileSync(soundPath);
      return c.body(buf, 200, {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=3600",
      });
    } catch {
      return c.text("Not found", 404);
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

  // Voice config status endpoint
  app.get("/api/voice/config", (c) => {
    const ttsConfig = resolveTtsConfig(deps.config);
    const envKey = ttsConfig.provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY
      : process.env.OPENAI_API_KEY;
    const hasApiKey = Boolean(ttsConfig.apiKey || envKey);
    const ttsConfigured = ttsConfig.enabled && hasApiKey;
    const language = deps.config.voice?.language || "en-US";
    return c.json({
      success: true,
      data: {
        ttsEnabled: ttsConfig.enabled,
        ttsConfigured,
        provider: ttsConfig.provider,
        voice: ttsConfig.voice,
        language,
      },
    });
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
    const MAX_TTS_TEXT_LENGTH = 4096;
    if (body.text.length > MAX_TTS_TEXT_LENGTH) {
      return c.json({ success: false, error: `text must be at most ${MAX_TTS_TEXT_LENGTH} characters` }, 400);
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

  // Cron API routes
  if (deps.cronService) {
    const cronService = deps.cronService;
    const cronStorePath = deps.cronStorePath ?? "";

    app.get("/api/cron/status", async (c) => {
      try {
        const status = await cronService.status();
        return c.json({ success: true, data: status });
      } catch (err) {
        log.error(`Cron status failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: "Failed to get cron status" }, 500);
      }
    });

    app.get("/api/cron/jobs", async (c) => {
      try {
        const includeDisabled = c.req.query("includeDisabled") === "true";
        const jobs = await cronService.list({ includeDisabled });
        return c.json({ success: true, data: jobs });
      } catch (err) {
        log.error(`Cron list failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: "Failed to list cron jobs" }, 500);
      }
    });

    app.post("/api/cron/jobs", async (c) => {
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ success: false, error: "Invalid JSON body" }, 400);
      }
      const job = normalizeCronJobCreate(body);
      if (!job) {
        return c.json({ success: false, error: "Invalid job definition" }, 400);
      }
      try {
        const result = await cronService.add(job);
        return c.json({ success: true, data: result }, 201);
      } catch (err) {
        log.error(`Cron add failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: safeErrorMessage(err, "Failed to add cron job") }, 400);
      }
    });

    app.patch("/api/cron/jobs/:id", async (c) => {
      const id = c.req.param("id");
      if (!id || !/^[a-f0-9-]+$/i.test(id)) {
        return c.json({ success: false, error: "Invalid job ID" }, 400);
      }
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ success: false, error: "Invalid JSON body" }, 400);
      }
      const patch = normalizeCronJobPatch(body);
      if (!patch) {
        return c.json({ success: false, error: "Invalid patch" }, 400);
      }
      try {
        const result = await cronService.update(id, patch);
        return c.json({ success: true, data: result });
      } catch (err) {
        log.error(`Cron update failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: safeErrorMessage(err, "Failed to update cron job") }, 400);
      }
    });

    app.delete("/api/cron/jobs/:id", async (c) => {
      const id = c.req.param("id");
      if (!id || !/^[a-f0-9-]+$/i.test(id)) {
        return c.json({ success: false, error: "Invalid job ID" }, 400);
      }
      try {
        const result = await cronService.remove(id);
        return c.json({ success: true, data: result });
      } catch (err) {
        log.error(`Cron remove failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: safeErrorMessage(err, "Failed to remove cron job") }, 400);
      }
    });

    app.post("/api/cron/jobs/:id/run", async (c) => {
      const id = c.req.param("id");
      if (!id || !/^[a-f0-9-]+$/i.test(id)) {
        return c.json({ success: false, error: "Invalid job ID" }, 400);
      }
      try {
        const result = await cronService.run(id, "force");
        return c.json({ success: true, data: result });
      } catch (err) {
        log.error(`Cron run failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: safeErrorMessage(err, "Failed to run cron job") }, 400);
      }
    });

    app.get("/api/cron/jobs/:id/runs", async (c) => {
      const id = c.req.param("id");
      if (!id || !/^[a-f0-9-]+$/i.test(id)) {
        return c.json({ success: false, error: "Invalid job ID" }, 400);
      }
      const limitParam = c.req.query("limit");
      const limit = limitParam ? Math.max(1, Math.min(Number(limitParam) || 50, 5000)) : 50;
      try {
        const logPath = resolveCronRunLogPath({ storePath: cronStorePath, jobId: id });
        const entries = await readCronRunLogEntries(logPath, { jobId: id, limit });
        return c.json({ success: true, data: entries });
      } catch (err) {
        log.error(`Cron runs failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: "Failed to read run history" }, 500);
      }
    });

    app.post("/api/cron/wake", async (c) => {
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ success: false, error: "Invalid JSON body" }, 400);
      }
      if (typeof body.text !== "string" || body.text.trim().length === 0) {
        return c.json({ success: false, error: "text must be a non-empty string" }, 400);
      }
      const mode = body.mode === "now" ? "now" : "next-heartbeat";
      try {
        const result = cronService.wake({ mode: mode as "now" | "next-heartbeat", text: body.text });
        return c.json({ success: true, data: result });
      } catch (err) {
        log.error(`Cron wake failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: "Failed to send wake event" }, 500);
      }
    });

    app.get("/api/cron/calendar", async (c) => {
      const daysParam = c.req.query("days");
      const days = Math.max(1, Math.min(Number(daysParam) || 60, 90));
      try {
        const jobs = await cronService.list();
        const runs = projectFutureRuns(jobs, days);
        return c.json({
          success: true,
          data: {
            runs,
            jobs: jobs.map((j) => ({
              id: j.id,
              name: j.name,
              enabled: j.enabled,
              schedule: j.schedule,
            })),
          },
        });
      } catch (err) {
        log.error(`Calendar failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: "Failed to compute calendar" }, 500);
      }
    });
  }

  // ASAP Queue routes
  if (deps.asapRunner) {
    const asapRunner = deps.asapRunner;

    app.get("/api/asap/jobs", async (c) => {
      try {
        const jobs = await asapRunner.list();
        return c.json({ success: true, data: jobs });
      } catch (err) {
        log.error(`ASAP list failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: "Failed to list ASAP jobs" }, 500);
      }
    });

    app.post("/api/asap/jobs", async (c) => {
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ success: false, error: "Invalid JSON body" }, 400);
      }
      if (typeof body.name !== "string" || body.name.trim().length === 0 || body.name.length > 200) {
        return c.json({ success: false, error: "name must be a non-empty string (max 200 chars)" }, 400);
      }
      if (typeof body.description !== "string" || body.description.trim().length === 0 || body.description.length > 10000) {
        return c.json({ success: false, error: "description must be a non-empty string (max 10000 chars)" }, 400);
      }
      try {
        const job = await asapRunner.enqueue(body.name.trim(), body.description.trim());
        return c.json({ success: true, data: job }, 201);
      } catch (err) {
        log.error(`ASAP create failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: safeErrorMessage(err, "Failed to create ASAP job") }, 500);
      }
    });

    app.patch("/api/asap/jobs/:id", async (c) => {
      const id = c.req.param("id");
      if (!id || !/^[a-f0-9-]+$/i.test(id)) {
        return c.json({ success: false, error: "Invalid job ID" }, 400);
      }
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ success: false, error: "Invalid JSON body" }, 400);
      }
      const VALID_STATUSES = new Set(["pending", "running", "done", "failed"]);
      if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
        return c.json({ success: false, error: "status must be one of: pending, running, done, failed" }, 400);
      }
      try {
        await asapRunner.updateStatus(id, { status: body.status as "pending" | "running" | "done" | "failed" });
        return c.json({ success: true });
      } catch (err) {
        log.error(`ASAP update failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: safeErrorMessage(err, "Failed to update ASAP job") }, 400);
      }
    });

    app.delete("/api/asap/jobs/:id", async (c) => {
      const id = c.req.param("id");
      if (!id || !/^[a-f0-9-]+$/i.test(id)) {
        return c.json({ success: false, error: "Invalid job ID" }, 400);
      }
      try {
        await asapRunner.remove(id);
        return c.json({ success: true });
      } catch (err) {
        log.error(`ASAP remove failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: safeErrorMessage(err, "Failed to remove ASAP job") }, 400);
      }
    });

    app.post("/api/asap/jobs/:id/run", async (c) => {
      const id = c.req.param("id");
      if (!id || !/^[a-f0-9-]+$/i.test(id)) {
        return c.json({ success: false, error: "Invalid job ID" }, 400);
      }
      try {
        await asapRunner.forceRun(id);
        return c.json({ success: true });
      } catch (err) {
        log.error(`ASAP run failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ success: false, error: safeErrorMessage(err, "Failed to run ASAP job") }, 400);
      }
    });
  }

  // Mount canvas routes
  const canvasApp = createCanvasRoutes(deps.dataDir);
  app.route("/canvas", canvasApp);

  // Static files (read once at startup, not per-request in production)
  const safeReadFile = (filePath: string): string => {
    try {
      return readFileSync(filePath, "utf-8");
    } catch (err) {
      log.warn(`Static file not found: ${filePath}`);
      return "";
    }
  };

  const getStaticContent = (filePath: string, cached: string): string => {
    if (process.env.NODE_ENV === "development") {
      return safeReadFile(filePath);
    }
    return cached;
  };

  const cssPath = resolve(publicDir, "styles.css");
  const jsPath = resolve(publicDir, "app.js");
  const soundFxJsPath = resolve(publicDir, "sound-fx.js");
  const voiceJsPath = resolve(publicDir, "voice.js");
  const canvasJsPath = resolve(publicDir, "canvas.js");
  const cronJsPath = resolve(publicDir, "cron.js");
  const memoryJsPath = resolve(publicDir, "memory.js");
  const calendarJsPath = resolve(publicDir, "calendar.js");
  const asapJsPath = resolve(publicDir, "asap.js");
  const htmlPath = resolve(publicDir, "index.html");

  const cssContent = safeReadFile(cssPath);
  const jsContent = safeReadFile(jsPath);
  const soundFxJsContent = safeReadFile(soundFxJsPath);
  const voiceJsContent = safeReadFile(voiceJsPath);
  const canvasJsContent = safeReadFile(canvasJsPath);
  const cronJsContent = safeReadFile(cronJsPath);
  const memoryJsContent = safeReadFile(memoryJsPath);
  const calendarJsContent = safeReadFile(calendarJsPath);
  const asapJsContent = safeReadFile(asapJsPath);
  const htmlContent = safeReadFile(htmlPath);

  const STATIC_CACHE = "public, max-age=300";

  app.get("/styles.css", (c) => {
    return c.text(getStaticContent(cssPath, cssContent), 200, { "Content-Type": "text/css", "Cache-Control": STATIC_CACHE });
  });

  app.get("/app.js", (c) => {
    return c.text(getStaticContent(jsPath, jsContent), 200, { "Content-Type": "application/javascript", "Cache-Control": STATIC_CACHE });
  });

  app.get("/sound-fx.js", (c) => {
    return c.text(getStaticContent(soundFxJsPath, soundFxJsContent), 200, { "Content-Type": "application/javascript", "Cache-Control": STATIC_CACHE });
  });

  app.get("/voice.js", (c) => {
    return c.text(getStaticContent(voiceJsPath, voiceJsContent), 200, { "Content-Type": "application/javascript", "Cache-Control": STATIC_CACHE });
  });

  app.get("/canvas.js", (c) => {
    return c.text(getStaticContent(canvasJsPath, canvasJsContent), 200, { "Content-Type": "application/javascript", "Cache-Control": STATIC_CACHE });
  });

  app.get("/cron.js", (c) => {
    return c.text(getStaticContent(cronJsPath, cronJsContent), 200, { "Content-Type": "application/javascript", "Cache-Control": STATIC_CACHE });
  });

  app.get("/memory.js", (c) => {
    return c.text(getStaticContent(memoryJsPath, memoryJsContent), 200, { "Content-Type": "application/javascript", "Cache-Control": STATIC_CACHE });
  });

  app.get("/calendar.js", (c) => {
    return c.text(getStaticContent(calendarJsPath, calendarJsContent), 200, { "Content-Type": "application/javascript", "Cache-Control": STATIC_CACHE });
  });

  app.get("/asap.js", (c) => {
    return c.text(getStaticContent(asapJsPath, asapJsContent), 200, { "Content-Type": "application/javascript", "Cache-Control": STATIC_CACHE });
  });

  app.get("/", (c) => {
    return c.html(getStaticContent(htmlPath, htmlContent));
  });

  return app;
}
