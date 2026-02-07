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
    if (raw.startsWith("~")) {
      return path.resolve(raw.replace("~", os.homedir()));
    }
    return path.resolve(raw);
  }
  return defaultCronStorePath(config);
}

export async function loadCronStore(storePath: string): Promise<CronStoreFile> {
  try {
    const raw = await fs.promises.readFile(storePath, "utf-8");
    const parsed = JSON5.parse(raw);
    const jobs = Array.isArray(parsed?.jobs) ? (parsed?.jobs as never[]) : [];
    return {
      version: 1,
      jobs: jobs.filter(Boolean) as never as CronStoreFile["jobs"],
    };
  } catch {
    return { version: 1, jobs: [] };
  }
}

export async function saveCronStore(storePath: string, store: CronStoreFile) {
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const json = JSON.stringify(store, null, 2);
  await fs.promises.writeFile(tmp, json, "utf-8");
  await fs.promises.rename(tmp, storePath);
  try {
    await fs.promises.copyFile(storePath, `${storePath}.bak`);
  } catch {
    // best-effort
  }
}
