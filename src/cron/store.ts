import JSON5 from "json5";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CronStoreFile } from "./types.js";
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
      jobs: jobs.filter(Boolean) as never as CronStoreFile["jobs"],
    };
  } catch (parseErr) {
    // Log corruption warning (structured logging not available at this layer)
    const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    process.stderr.write(`[cron:store] Corrupt cron store at ${storePath}: ${errMsg}\n`);
    // Preserve corrupt file for debugging
    try {
      await fs.promises.copyFile(storePath, `${storePath}.corrupt.${Date.now()}`);
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
    await fs.promises.copyFile(storePath, `${storePath}.bak`);
  } catch {
    // best-effort — file may not exist yet on first save
  }
  try {
    await fs.promises.rename(tmp, storePath);
  } catch (renameErr) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw renameErr;
  }
}
