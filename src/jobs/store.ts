import fs from "node:fs";
import path from "node:path";
import type { AsapJob, AsapStore } from "./types.js";

const EMPTY_STORE: AsapStore = { version: 1, jobs: [] };

export async function loadAsapStore(filePath: string): Promise<AsapStore> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, "utf-8");
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return EMPTY_STORE;
    }
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
    return {
      version: 1,
      jobs: jobs.filter(isValidAsapJob),
    };
  } catch {
    return EMPTY_STORE;
  }
}

export async function saveAsapStore(filePath: string, store: AsapStore): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const json = JSON.stringify(store, null, 2);
  await fs.promises.writeFile(tmp, json, "utf-8");
  try {
    await fs.promises.rename(tmp, filePath);
  } catch (renameErr) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw renameErr;
  }
}

export function addJob(store: AsapStore, job: AsapJob): AsapStore {
  return { ...store, jobs: [...store.jobs, job] };
}

export function updateJobStatus(
  store: AsapStore,
  id: string,
  patch: Partial<Pick<AsapJob, "status" | "startedAt" | "completedAt" | "error">>,
): AsapStore {
  return {
    ...store,
    jobs: store.jobs.map((j) =>
      j.id === id ? { ...j, ...patch } : j,
    ),
  };
}

export function getNextPending(store: AsapStore): AsapJob | undefined {
  return store.jobs.find((j) => j.status === "pending");
}

export function removeJob(store: AsapStore, id: string): AsapStore {
  return { ...store, jobs: store.jobs.filter((j) => j.id !== id) };
}

const VALID_STATUSES: ReadonlySet<string> = new Set(["pending", "running", "done", "failed"]);

function isValidAsapJob(raw: unknown): raw is AsapJob {
  if (raw === null || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.description === "string" &&
    typeof r.status === "string" &&
    VALID_STATUSES.has(r.status) &&
    typeof r.createdAt === "string"
  );
}
