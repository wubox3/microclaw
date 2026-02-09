import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { VoiceWakeConfig } from "./types.js";

const DEFAULT_TRIGGERS = ["eclaw", "claude", "computer"];
const MAX_TRIGGERS = 50;

function sanitizeTriggers(triggers: string[] | undefined | null): string[] {
  const seen = new Set<string>();
  const cleaned = (triggers ?? [])
    .map((w) => (typeof w === "string" ? w.trim().toLowerCase() : ""))
    .filter((w) => {
      if (w.length === 0 || seen.has(w)) return false;
      seen.add(w);
      return true;
    })
    .slice(0, MAX_TRIGGERS);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_TRIGGERS];
}

async function readJSON<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJSONAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

const locks = new Map<string, Promise<void>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => {
    release = r;
  });
  locks.set(key, current);

  await prev.catch(() => {});

  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === current) {
      locks.delete(key);
    }
  }
}

export function defaultVoiceWakeTriggers(): string[] {
  return [...DEFAULT_TRIGGERS];
}

function resolvePath(dataDir: string): string {
  return path.join(dataDir, "settings", "voicewake.json");
}

export async function loadVoiceWakeConfig(dataDir: string): Promise<VoiceWakeConfig> {
  const filePath = resolvePath(dataDir);
  const existing = await readJSON<VoiceWakeConfig>(filePath);
  if (!existing) {
    return { triggers: defaultVoiceWakeTriggers(), updatedAtMs: 0 };
  }
  return {
    triggers: sanitizeTriggers(existing.triggers),
    updatedAtMs:
      typeof existing.updatedAtMs === "number" && existing.updatedAtMs > 0
        ? existing.updatedAtMs
        : 0,
  };
}

export async function setVoiceWakeTriggers(
  triggers: string[],
  dataDir: string,
): Promise<VoiceWakeConfig> {
  const sanitized = sanitizeTriggers(triggers);
  const filePath = resolvePath(dataDir);
  return await withLock(dataDir, async () => {
    const next: VoiceWakeConfig = {
      triggers: sanitized,
      updatedAtMs: Date.now(),
    };
    await writeJSONAtomic(filePath, next);
    return next;
  });
}
