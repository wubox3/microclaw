import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AsapRunner } from "./runner.js";
import { loadAsapStore } from "./store.js";

describe("AsapRunner", () => {
  let tmpDir: string;
  let storePath: string;
  let events: string[];
  let runner: AsapRunner;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "asap-runner-test-"));
    storePath = path.join(tmpDir, "asap-jobs.json");
    events = [];
    runner = new AsapRunner({
      storePath,
      enqueueSystemEvent: (text) => { events.push(text); },
    });
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("enqueues and processes a job", async () => {
    const job = await runner.enqueue("Test", "Do something");
    expect(job.status).toBe("pending");
    expect(job.name).toBe("Test");

    // Wait for async processNext to complete
    await new Promise((r) => setTimeout(r, 100));

    const store = await loadAsapStore(storePath);
    const saved = store.jobs.find((j) => j.id === job.id);
    expect(saved?.status).toBe("done");
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("ASAP Job: Test");
    expect(events[0]).toContain("Do something");
  });

  it("processes jobs sequentially", async () => {
    await runner.enqueue("First", "First task");
    await runner.enqueue("Second", "Second task");

    // Wait for both jobs to process through the serialized queue
    await new Promise((r) => setTimeout(r, 500));

    const store = await loadAsapStore(storePath);
    const doneJobs = store.jobs.filter((j) => j.status === "done");
    expect(doneJobs).toHaveLength(2);
    expect(events).toHaveLength(2);
  });

  it("failed job does not block queue", async () => {
    const failRunner = new AsapRunner({
      storePath,
      enqueueSystemEvent: (text) => {
        if (text.includes("Fail")) {
          throw new Error("Simulated failure");
        }
        events.push(text);
      },
    });

    await failRunner.enqueue("Fail", "Should fail");
    await new Promise((r) => setTimeout(r, 100));
    await failRunner.enqueue("Success", "Should succeed");
    await new Promise((r) => setTimeout(r, 100));

    const store = await loadAsapStore(storePath);
    const failedJob = store.jobs.find((j) => j.name === "Fail");
    const successJob = store.jobs.find((j) => j.name === "Success");
    expect(failedJob?.status).toBe("failed");
    expect(successJob?.status).toBe("done");
  });

  it("lists all jobs", async () => {
    await runner.enqueue("A", "first");
    await runner.enqueue("B", "second");
    await new Promise((r) => setTimeout(r, 500));

    const jobs = await runner.list();
    expect(jobs).toHaveLength(2);
  });

  it("removes a job", async () => {
    const job = await runner.enqueue("ToRemove", "remove me");
    await new Promise((r) => setTimeout(r, 100));
    await runner.remove(job.id);

    const jobs = await runner.list();
    expect(jobs.find((j) => j.id === job.id)).toBeUndefined();
  });

  it("empty queue is a no-op", async () => {
    await runner.processNext();
    expect(events).toHaveLength(0);
  });
});
