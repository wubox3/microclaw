import { describe, it, expect } from "vitest";
import { projectFutureRuns } from "./calendar.js";
import type { CronJob } from "./types.js";

function makeJob(overrides: Partial<CronJob>): CronJob {
  return {
    id: "test-id",
    name: "Test Job",
    enabled: true,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    schedule: { kind: "cron", expr: "0 0 * * *" },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: "test" },
    state: {},
    ...overrides,
  };
}

describe("projectFutureRuns", () => {
  it("returns empty array for no jobs", () => {
    const result = projectFutureRuns([], 60);
    expect(result).toEqual([]);
  });

  it("skips disabled jobs", () => {
    const jobs = [makeJob({ enabled: false })];
    const result = projectFutureRuns(jobs, 60);
    expect(result).toEqual([]);
  });

  it("projects 'at' schedule — future date", () => {
    const futureMs = Date.now() + 5 * 24 * 60 * 60 * 1000;
    const jobs = [makeJob({
      id: "at-1",
      name: "One-time",
      schedule: { kind: "at", at: new Date(futureMs).toISOString() },
    })];
    const result = projectFutureRuns(jobs, 60);
    expect(result).toHaveLength(1);
    expect(result[0].jobId).toBe("at-1");
    expect(result[0].jobName).toBe("One-time");
    expect(result[0].runAtMs).toBeCloseTo(futureMs, -3);
  });

  it("projects 'at' schedule — past date returns empty", () => {
    const pastMs = Date.now() - 1000;
    const jobs = [makeJob({
      schedule: { kind: "at", at: new Date(pastMs).toISOString() },
    })];
    const result = projectFutureRuns(jobs, 60);
    expect(result).toHaveLength(0);
  });

  it("projects 'every' schedule — multiple runs", () => {
    const everyMs = 12 * 60 * 60 * 1000; // 12 hours
    const jobs = [makeJob({
      id: "every-1",
      name: "Interval",
      schedule: { kind: "every", everyMs, anchorMs: Date.now() },
    })];
    const result = projectFutureRuns(jobs, 3);
    // 3 days = 72h / 12h = 6 runs
    expect(result.length).toBeGreaterThanOrEqual(5);
    expect(result.length).toBeLessThanOrEqual(7);
    for (const run of result) {
      expect(run.jobId).toBe("every-1");
    }
  });

  it("projects 'cron' schedule — daily job over 7 days", () => {
    const jobs = [makeJob({
      id: "cron-1",
      name: "Daily",
      schedule: { kind: "cron", expr: "0 9 * * *" },
    })];
    const result = projectFutureRuns(jobs, 7);
    // Should have ~7 runs (one per day at 9am)
    expect(result.length).toBeGreaterThanOrEqual(6);
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it("returns results sorted by runAtMs", () => {
    const jobs = [
      makeJob({
        id: "hourly",
        name: "Hourly",
        schedule: { kind: "cron", expr: "0 * * * *" },
      }),
      makeJob({
        id: "daily",
        name: "Daily",
        schedule: { kind: "cron", expr: "30 12 * * *" },
      }),
    ];
    const result = projectFutureRuns(jobs, 3);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].runAtMs).toBeGreaterThanOrEqual(result[i - 1].runAtMs);
    }
  });

  it("handles invalid cron expression gracefully", () => {
    const jobs = [makeJob({
      schedule: { kind: "cron", expr: "not-valid" },
    })];
    const result = projectFutureRuns(jobs, 60);
    expect(result).toEqual([]);
  });

  it("respects day boundary — at job beyond horizon excluded", () => {
    const beyondMs = Date.now() + 100 * 24 * 60 * 60 * 1000;
    const jobs = [makeJob({
      schedule: { kind: "at", at: new Date(beyondMs).toISOString() },
    })];
    const result = projectFutureRuns(jobs, 60);
    expect(result).toHaveLength(0);
  });
});
