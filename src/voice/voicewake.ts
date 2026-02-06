import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { VoiceWakeConfig } from "./types.js";

const DEFAULT_TRIGGERS = ["microclaw", "claude", "computer"];

function sanitizeTriggers(triggers: string[] | undefined | null): string[] {
  const cleaned = (triggers ?? [])
    .map((w) => (typeof w === "string" ? w.trim().toLowerCase() : ""))
    .filter((w) => w.length > 0);
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

let lock: Promise<void> = Promise.resolve();

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = lock;
  let release: (() => void) | undefined;
  lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release?.();
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
  return await withLock(async () => {
    const next: VoiceWakeConfig = {
      triggers: sanitized,
      updatedAtMs: Date.now(),
    };
    await writeJSONAtomic(filePath, next);
    return next;
  });
}
