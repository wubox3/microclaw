import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadAsapStore,
  saveAsapStore,
  addJob,
  updateJobStatus,
  getNextPending,
  removeJob,
} from "./store.js";
import type { AsapJob, AsapStore } from "./types.js";

function makeJob(overrides?: Partial<AsapJob>): AsapJob {
  return {
    id: "job-1",
    name: "Test Job",
    description: "Do the thing",
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ASAP store", () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "asap-test-"));
    storePath = path.join(tmpDir, "asap-jobs.json");
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  describe("loadAsapStore", () => {
    it("returns empty store when file does not exist", async () => {
      const store = await loadAsapStore(storePath);
      expect(store).toEqual({ version: 1, jobs: [] });
    });

    it("loads existing store from disk", async () => {
      const data: AsapStore = { version: 1, jobs: [makeJob()] };
      await fs.promises.writeFile(storePath, JSON.stringify(data), "utf-8");
      const store = await loadAsapStore(storePath);
      expect(store.jobs).toHaveLength(1);
      expect(store.jobs[0].id).toBe("job-1");
    });

    it("returns empty store for corrupt JSON", async () => {
      await fs.promises.writeFile(storePath, "not-json", "utf-8");
      const store = await loadAsapStore(storePath);
      expect(store).toEqual({ version: 1, jobs: [] });
    });
  });

  describe("saveAsapStore", () => {
    it("writes store to disk atomically", async () => {
      const store: AsapStore = { version: 1, jobs: [makeJob()] };
      await saveAsapStore(storePath, store);
      const raw = await fs.promises.readFile(storePath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.jobs).toHaveLength(1);
    });

    it("creates parent directories if missing", async () => {
      const nested = path.join(tmpDir, "deep", "nested", "store.json");
      await saveAsapStore(nested, { version: 1, jobs: [] });
      const exists = fs.existsSync(nested);
      expect(exists).toBe(true);
    });
  });

  describe("addJob", () => {
    it("appends job immutably", () => {
      const store: AsapStore = { version: 1, jobs: [makeJob({ id: "a" })] };
      const updated = addJob(store, makeJob({ id: "b" }));
      expect(updated.jobs).toHaveLength(2);
      expect(updated.jobs[1].id).toBe("b");
      // Original unchanged
      expect(store.jobs).toHaveLength(1);
    });
  });

  describe("updateJobStatus", () => {
    it("updates status immutably", () => {
      const store: AsapStore = { version: 1, jobs: [makeJob()] };
      const updated = updateJobStatus(store, "job-1", { status: "running" });
      expect(updated.jobs[0].status).toBe("running");
      expect(store.jobs[0].status).toBe("pending");
    });

    it("leaves other jobs unchanged", () => {
      const store: AsapStore = {
        version: 1,
        jobs: [makeJob({ id: "a" }), makeJob({ id: "b" })],
      };
      const updated = updateJobStatus(store, "a", { status: "done" });
      expect(updated.jobs[0].status).toBe("done");
      expect(updated.jobs[1].status).toBe("pending");
    });
  });

  describe("getNextPending", () => {
    it("returns first pending job by order", () => {
      const store: AsapStore = {
        version: 1,
        jobs: [
          makeJob({ id: "done-1", status: "done" }),
          makeJob({ id: "pending-1", status: "pending" }),
          makeJob({ id: "pending-2", status: "pending" }),
        ],
      };
      const next = getNextPending(store);
      expect(next?.id).toBe("pending-1");
    });

    it("returns undefined when no pending jobs", () => {
      const store: AsapStore = {
        version: 1,
        jobs: [makeJob({ id: "done-1", status: "done" })],
      };
      expect(getNextPending(store)).toBeUndefined();
    });
  });

  describe("removeJob", () => {
    it("removes job immutably", () => {
      const store: AsapStore = {
        version: 1,
        jobs: [makeJob({ id: "a" }), makeJob({ id: "b" })],
      };
      const updated = removeJob(store, "a");
      expect(updated.jobs).toHaveLength(1);
      expect(updated.jobs[0].id).toBe("b");
      expect(store.jobs).toHaveLength(2);
    });
  });
});
