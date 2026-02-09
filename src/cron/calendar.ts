import { Cron } from "croner";
import type { CronJob, CronSchedule } from "./types.js";
import { computeNextRunAtMs } from "./schedule.js";

export type ProjectedRun = {
  readonly jobId: string;
  readonly jobName: string;
  readonly runAtMs: number;
};

/**
 * Project future run times for all enabled cron jobs over the next N days.
 * Returns a sorted array of projected runs (earliest first).
 */
export function projectFutureRuns(
  jobs: readonly CronJob[],
  days: number,
): readonly ProjectedRun[] {
  const nowMs = Date.now();
  const horizonMs = nowMs + days * 24 * 60 * 60 * 1000;
  const runs: ProjectedRun[] = [];

  for (const job of jobs) {
    if (!job.enabled) continue;
    const projected = projectJobRuns(job, nowMs, horizonMs);
    for (const runAtMs of projected) {
      runs.push({ jobId: job.id, jobName: job.name, runAtMs });
    }
  }

  return runs.sort((a, b) => a.runAtMs - b.runAtMs);
}

function projectJobRuns(
  job: CronJob,
  nowMs: number,
  horizonMs: number,
): readonly number[] {
  const { schedule } = job;

  if (schedule.kind === "at") {
    return projectAtRuns(schedule, nowMs, horizonMs);
  }

  if (schedule.kind === "every") {
    return projectEveryRuns(schedule, nowMs, horizonMs);
  }

  return projectCronRuns(schedule, nowMs, horizonMs);
}

function projectAtRuns(
  schedule: CronSchedule & { kind: "at" },
  nowMs: number,
  horizonMs: number,
): readonly number[] {
  const next = computeNextRunAtMs(schedule, nowMs);
  if (next !== undefined && next <= horizonMs) {
    return [next];
  }
  return [];
}

function projectEveryRuns(
  schedule: CronSchedule & { kind: "every" },
  nowMs: number,
  horizonMs: number,
): readonly number[] {
  const runs: number[] = [];
  const MAX_RUNS = 5000;
  let cursor = nowMs;

  while (runs.length < MAX_RUNS) {
    const next = computeNextRunAtMs(schedule, cursor);
    if (next === undefined || next > horizonMs) break;
    runs.push(next);
    cursor = next;
  }

  return runs;
}

function projectCronRuns(
  schedule: CronSchedule & { kind: "cron" },
  nowMs: number,
  horizonMs: number,
): readonly number[] {
  const expr = schedule.expr.trim();
  if (!expr) return [];

  try {
    const cron = new Cron(expr, {
      timezone: schedule.tz?.trim() || undefined,
    });

    const runs: number[] = [];
    const MAX_RUNS = 5000;
    let cursor = new Date(nowMs);

    while (runs.length < MAX_RUNS) {
      const next = cron.nextRun(cursor);
      if (!next || next.getTime() > horizonMs) break;
      runs.push(next.getTime());
      cursor = new Date(next.getTime() + 1);
    }

    return runs;
  } catch {
    return [];
  }
}
