import crypto from "node:crypto";
import { createLogger } from "../logging.js";
import type { AsapJob } from "./types.js";
import {
  loadAsapStore,
  saveAsapStore,
  addJob,
  updateJobStatus,
  getNextPending,
  removeJob,
} from "./store.js";

const log = createLogger("asap-runner");

export type AsapRunnerDeps = {
  readonly storePath: string;
  readonly enqueueSystemEvent: (text: string) => void;
};

export class AsapRunner {
  private readonly storePath: string;
  private readonly enqueueSystemEvent: (text: string) => void;
  private processing = false;
  /** Serialize all store mutations to avoid read-modify-write races. */
  private storeQueue: Promise<void> = Promise.resolve();

  constructor(deps: AsapRunnerDeps) {
    this.storePath = deps.storePath;
    this.enqueueSystemEvent = deps.enqueueSystemEvent;
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.storeQueue.then(fn, fn);
    this.storeQueue = next.then(() => {}, () => {});
    return next;
  }

  async enqueue(name: string, description: string): Promise<AsapJob> {
    const job: AsapJob = {
      id: crypto.randomUUID(),
      name,
      description,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await this.serialize(async () => {
      const store = await loadAsapStore(this.storePath);
      const updated = addJob(store, job);
      await saveAsapStore(this.storePath, updated);
    });
    this.scheduleProcessNext();
    return job;
  }

  async list(): Promise<readonly AsapJob[]> {
    const store = await loadAsapStore(this.storePath);
    return store.jobs;
  }

  async remove(id: string): Promise<void> {
    await this.serialize(async () => {
      const store = await loadAsapStore(this.storePath);
      const updated = removeJob(store, id);
      await saveAsapStore(this.storePath, updated);
    });
  }

  async updateStatus(
    id: string,
    patch: Partial<Pick<AsapJob, "status" | "startedAt" | "completedAt" | "error">>,
  ): Promise<void> {
    await this.serialize(async () => {
      const store = await loadAsapStore(this.storePath);
      const updated = updateJobStatus(store, id, patch);
      await saveAsapStore(this.storePath, updated);
    });
  }

  async forceRun(id: string): Promise<void> {
    await this.serialize(async () => {
      const store = await loadAsapStore(this.storePath);
      const job = store.jobs.find((j) => j.id === id);
      if (!job) throw new Error(`Job ${id} not found`);
      if (job.status === "running") throw new Error(`Job ${id} is already running`);
      const updated = updateJobStatus(store, id, { status: "pending" });
      await saveAsapStore(this.storePath, updated);
    });
    this.scheduleProcessNext();
  }

  private scheduleProcessNext(): void {
    this.processNext().catch((err) => {
      log.error(`ASAP processNext error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      // Find next pending job (serialized read-modify-write)
      const next = await this.serialize(async () => {
        const store = await loadAsapStore(this.storePath);
        const pending = getNextPending(store);
        if (!pending) return undefined;

        const running = updateJobStatus(store, pending.id, {
          status: "running",
          startedAt: new Date().toISOString(),
        });
        await saveAsapStore(this.storePath, running);
        return pending;
      });

      if (!next) return;

      try {
        const eventText = `ASAP Job: ${next.name}\n\n${next.description}`;
        this.enqueueSystemEvent(eventText);

        await this.serialize(async () => {
          const store = await loadAsapStore(this.storePath);
          const done = updateJobStatus(store, next.id, {
            status: "done",
            completedAt: new Date().toISOString(),
          });
          await saveAsapStore(this.storePath, done);
        });
        log.info(`ASAP job completed: ${next.name}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await this.serialize(async () => {
          const store = await loadAsapStore(this.storePath);
          const failed = updateJobStatus(store, next.id, {
            status: "failed",
            completedAt: new Date().toISOString(),
            error: errorMsg,
          });
          await saveAsapStore(this.storePath, failed);
        });
        log.error(`ASAP job failed: ${next.name}: ${errorMsg}`);
      }
    } finally {
      this.processing = false;
    }

    // Check for more pending jobs (serialized to avoid stale reads)
    const hasPending = await this.serialize(async () => {
      const store = await loadAsapStore(this.storePath);
      return getNextPending(store) !== undefined;
    });
    if (hasPending) {
      this.scheduleProcessNext();
    }
  }
}
