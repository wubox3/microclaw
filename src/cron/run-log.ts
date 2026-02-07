import fs from "node:fs/promises";
import path from "node:path";

export type CronRunLogEntry = {
  ts: number;
  jobId: string;
  action: "finished";
  status?: "ok" | "error" | "skipped";
  error?: string;
  summary?: string;
  runAtMs?: number;
  durationMs?: number;
  nextRunAtMs?: number;
};

export function resolveCronRunLogPath(params: { storePath: string; jobId: string }) {
  const storePath = path.resolve(params.storePath);
  const dir = path.dirname(storePath);
  // Sanitize jobId to prevent path traversal (strip path separators and null bytes)
  const safeJobId = params.jobId.replace(/[/\\:\0]/g, "_");
  if (!safeJobId) {
    throw new Error("Invalid job ID: empty after sanitization");
  }
  const resolved = path.join(dir, "runs", `${safeJobId}.jsonl`);
  const runsDir = path.join(dir, "runs");
  if (!resolved.startsWith(runsDir + path.sep) && resolved !== runsDir) {
    throw new Error(`Invalid job ID: resolved path escapes runs directory`);
  }
  return resolved;
}

const writesByPath = new Map<string, Promise<void>>();
const VALID_STATUSES = new Set(["ok", "error", "skipped"]);

async function pruneIfNeeded(filePath: string, opts: { maxBytes: number; keepLines: number }) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || stat.size <= opts.maxBytes) {
    return;
  }

  const raw = await fs.readFile(filePath, "utf-8").catch(() => "");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const kept = lines.slice(Math.max(0, lines.length - opts.keepLines));
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(tmp, `${kept.join("\n")}\n`, "utf-8");
  try {
    await fs.rename(tmp, filePath);
  } catch (renameErr) {
    await fs.unlink(tmp).catch(() => {});
    throw renameErr;
  }
}

export async function appendCronRunLog(
  filePath: string,
  entry: CronRunLogEntry,
  opts?: { maxBytes?: number; keepLines?: number },
) {
  const resolved = path.resolve(filePath);
  const prev = writesByPath.get(resolved) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.appendFile(resolved, `${JSON.stringify(entry)}\n`, "utf-8");
      await pruneIfNeeded(resolved, {
        maxBytes: opts?.maxBytes ?? 2_000_000,
        keepLines: opts?.keepLines ?? 2_000,
      });
    })
    .finally(() => {
      if (writesByPath.get(resolved) === next) {
        writesByPath.delete(resolved);
      }
    });
  writesByPath.set(resolved, next);
  await next;
}

export async function readCronRunLogEntries(
  filePath: string,
  opts?: { limit?: number; jobId?: string },
): Promise<CronRunLogEntry[]> {
  const limit = Math.max(1, Math.min(5000, Math.floor(opts?.limit ?? 200)));
  const jobId = opts?.jobId?.trim() || undefined;
  const raw = await fs.readFile(path.resolve(filePath), "utf-8").catch(() => "");
  if (!raw.trim()) {
    return [];
  }
  const parsed: CronRunLogEntry[] = [];
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0 && parsed.length < limit; i--) {
    const line = lines[i]?.trim();
    if (!line) {
      continue;
    }
    try {
      const obj = JSON.parse(line) as Partial<CronRunLogEntry> | null;
      if (!obj || typeof obj !== "object") {
        continue;
      }
      if (obj.action !== "finished") {
        continue;
      }
      if (typeof obj.jobId !== "string" || obj.jobId.trim().length === 0) {
        continue;
      }
      if (typeof obj.ts !== "number" || !Number.isFinite(obj.ts)) {
        continue;
      }
      if (jobId && obj.jobId !== jobId) {
        continue;
      }
      if (obj.status !== undefined && !VALID_STATUSES.has(obj.status)) {
        continue;
      }
      parsed.push(obj as CronRunLogEntry);
    } catch {
      // ignore invalid lines
    }
  }
  return parsed.toReversed();
}
