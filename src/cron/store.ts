import JSON5 from "json5";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CronJob, CronStoreFile } from "./types.js";
import { resolveDataDir } from "../config/config.js";

export function defaultCronDir(config?: import("../config/types.js").MicroClawConfig) {
  return path.join(resolveDataDir(config ?? {}), "cron");
}

export function defaultCronStorePath(config?: import("../config/types.js").MicroClawConfig) {
  return path.join(defaultCronDir(config), "jobs.json");
}

export function resolveCronStorePath(storePath?: string, config?: import("../config/types.js").MicroClawConfig) {
  if (storePath?.trim()) {
    const raw = storePath.trim();
    if (raw === "~" || raw.startsWith("~/")) {
      return path.resolve(raw.replace(/^~/, os.homedir()));
    }
    return path.resolve(raw);
  }
  return defaultCronStorePath(config);
}

export function isValidCronJob(raw: unknown): raw is CronJob {
  if (raw === null || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return typeof r.id === "string"
    && typeof r.name === "string"
    && r.schedule !== null && typeof r.schedule === "object"
    && r.payload !== null && typeof r.payload === "object";
}

export async function loadCronStore(storePath: string): Promise<CronStoreFile> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(storePath, "utf-8");
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return { version: 1, jobs: [] };
    }
    throw err;
  }
  try {
    const parsed = JSON5.parse(raw);
    const jobs = Array.isArray(parsed?.jobs) ? (parsed?.jobs as never[]) : [];
    return {
      version: 1,
      jobs: jobs.filter(isValidCronJob),
    };
  } catch (parseErr) {
    // Log corruption warning (structured logging not available at this layer)
    const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    process.stderr.write(`[cron:store] Corrupt cron store at ${storePath}: ${errMsg}\n`);
    // Preserve corrupt file for debugging
    try {
      await fs.promises.copyFile(storePath, `${storePath}.corrupt`);
    } catch {
      // best-effort
    }
    return { version: 1, jobs: [] };
  }
}

export async function saveCronStore(storePath: string, store: CronStoreFile) {
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const json = JSON.stringify(store, null, 2);
  await fs.promises.writeFile(tmp, json, "utf-8");
  try {
    // Only backup if existing file is valid JSON to avoid overwriting good backup with corrupt data
    const existing = await fs.promises.readFile(storePath, "utf-8");
    JSON.parse(existing);
    await fs.promises.copyFile(storePath, `${storePath}.bak`);
  } catch (backupErr) {
    const msg = backupErr instanceof Error ? backupErr.message : String(backupErr);
    if (msg && !msg.includes("ENOENT")) {
      process.stderr.write("[cron:store] Failed to create cron store backup: " + msg + "\n");
    }
  }
  try {
    await fs.promises.rename(tmp, storePath);
  } catch (renameErr) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw renameErr;
  }
}
