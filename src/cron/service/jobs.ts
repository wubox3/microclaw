import crypto from "node:crypto";
import type {
  CronDelivery,
  CronDeliveryPatch,
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronPayload,
  CronPayloadPatch,
} from "../types.js";
import { validateScheduleTimestamp } from "../validate-timestamp.js";
import type { CronServiceState } from "./state.js";
import { parseAbsoluteTimeMs } from "../parse.js";
import { computeNextRunAtMs } from "../schedule.js";
import {
  normalizeOptionalAgentId,
  normalizeOptionalText,
  normalizePayloadToSystemText,
  normalizeRequiredName,
} from "./normalize.js";

const STUCK_RUN_MS = 2 * 60 * 60 * 1000;

export function assertSupportedJobSpec(job: Pick<CronJob, "sessionTarget" | "payload">) {
  if (job.sessionTarget === "main" && job.payload.kind !== "systemEvent") {
    throw new Error('main cron jobs require payload.kind="systemEvent"');
  }
  if (job.sessionTarget === "isolated" && job.payload.kind !== "agentTurn") {
    throw new Error('isolated cron jobs require payload.kind="agentTurn"');
  }
}

function assertDeliverySupport(job: Pick<CronJob, "sessionTarget" | "delivery">) {
  if (job.delivery && job.sessionTarget !== "isolated") {
    throw new Error('cron delivery config is only supported for sessionTarget="isolated"');
  }
}

export function findJobOrThrow(state: CronServiceState, id: string) {
  const job = state.store?.jobs.find((j) => j.id === id);
  if (!job) {
    throw new Error(`unknown cron job id: ${id}`);
  }
  return job;
}

export function computeJobNextRunAtMs(job: CronJob, nowMs: number): number | undefined {
  if (!job.enabled) {
    return undefined;
  }
  if (job.schedule.kind === "at") {
    // One-shot jobs stay due until they successfully finish.
    if (job.state.lastStatus === "ok" && job.state.lastRunAtMs) {
      return undefined;
    }
    // Handle both canonical `at` (string) and legacy `atMs` (number) fields.
    const schedule = job.schedule as { at?: string; atMs?: number | string };
    const atMs =
      typeof schedule.atMs === "number" && Number.isFinite(schedule.atMs) && schedule.atMs > 0
        ? schedule.atMs
        : typeof schedule.atMs === "string"
          ? parseAbsoluteTimeMs(schedule.atMs)
          : typeof schedule.at === "string"
            ? parseAbsoluteTimeMs(schedule.at)
            : null;
    if (atMs === null) return undefined;
    return atMs > Date.now() ? atMs : undefined;
  }
  return computeNextRunAtMs(job.schedule, nowMs);
}

export function recomputeNextRuns(state: CronServiceState) {
  if (!state.store) {
    return;
  }
  const now = state.deps.nowMs();
  for (let i = 0; i < state.store.jobs.length; i++) {
    let job = state.store.jobs[i];
    if (!job.state) {
      job = { ...job, state: {} };
      state.store.jobs[i] = job;
    }
    if (!job.enabled) {
      job.state.nextRunAtMs = undefined;
      job.state.runningAtMs = undefined;
      continue;
    }
    const runningAt = job.state.runningAtMs;
    if (typeof runningAt === "number" && now - runningAt > STUCK_RUN_MS) {
      state.deps.log.warn(
        { jobId: job.id, runningAtMs: runningAt },
        "cron: clearing stuck running marker",
      );
      job.state.runningAtMs = undefined;
    }
    job.state.nextRunAtMs = computeJobNextRunAtMs(job, now);
  }
}

export function nextWakeAtMs(state: CronServiceState) {
  const jobs = state.store?.jobs ?? [];
  const enabled = jobs.filter((j) => j.enabled && typeof j.state.nextRunAtMs === "number");
  if (enabled.length === 0) {
    return undefined;
  }
  return enabled.reduce(
    (min, j) => Math.min(min, j.state.nextRunAtMs as number),
    enabled[0].state.nextRunAtMs as number,
  );
}

export function createJob(state: CronServiceState, input: CronJobCreate): CronJob {
  const now = state.deps.nowMs();
  const id = crypto.randomUUID();
  const deleteAfterRun =
    typeof input.deleteAfterRun === "boolean"
      ? input.deleteAfterRun
      : input.schedule.kind === "at"
        ? true
        : undefined;
  const enabled = typeof input.enabled === "boolean" ? input.enabled : true;
  const job: CronJob = {
    id,
    agentId: normalizeOptionalAgentId(input.agentId),
    name: normalizeRequiredName(input.name),
    description: normalizeOptionalText(input.description),
    enabled,
    deleteAfterRun,
    createdAtMs: now,
    updatedAtMs: now,
    schedule: input.schedule,
    sessionTarget: input.sessionTarget,
    wakeMode: input.wakeMode,
    payload: input.payload,
    delivery: input.delivery,
    state: {
      ...input.state,
    },
  };
  assertSupportedJobSpec(job);
  assertDeliverySupport(job);
  // Validate everyMs minimum to prevent busy-loop DoS
  if (job.schedule.kind === "every") {
    const MIN_EVERY_MS = 10_000;
    if (job.schedule.everyMs < MIN_EVERY_MS) {
      throw new Error(`everyMs must be at least ${MIN_EVERY_MS}ms (10 seconds)`);
    }
  }
  // Validate schedule timestamp for "at" jobs
  if (job.schedule.kind === "at") {
    const validation = validateScheduleTimestamp(job.schedule, now);
    if (!validation.ok) {
      throw new Error(validation.message);
    }
  }
  job.state.nextRunAtMs = computeJobNextRunAtMs(job, now);
  return job;
}

export function applyJobPatch(state: CronServiceState, id: string, job: CronJob, patch: CronJobPatch): CronJob {
  // Deep-clone so validation failures don't leave the original job
  // half-patched via shared nested object references.
  const draft = structuredClone(job);

  if ("name" in patch) {
    draft.name = normalizeRequiredName(patch.name);
  }
  if ("description" in patch) {
    draft.description = normalizeOptionalText(patch.description);
  }
  if (typeof patch.enabled === "boolean") {
    draft.enabled = patch.enabled;
  }
  if (typeof patch.deleteAfterRun === "boolean") {
    draft.deleteAfterRun = patch.deleteAfterRun;
  }
  if (patch.schedule) {
    draft.schedule = patch.schedule;
  }
  if (patch.sessionTarget) {
    draft.sessionTarget = patch.sessionTarget;
  }
  if (patch.wakeMode) {
    draft.wakeMode = patch.wakeMode;
  }
  if (patch.payload) {
    draft.payload = mergeCronPayload(draft.payload, patch.payload);
  }
  if (!patch.delivery && patch.payload?.kind === "agentTurn") {
    // Back-compat: legacy clients still update delivery via payload fields.
    const legacyDeliveryPatch = buildLegacyDeliveryPatch(patch.payload);
    if (
      legacyDeliveryPatch &&
      draft.sessionTarget === "isolated" &&
      draft.payload.kind === "agentTurn"
    ) {
      draft.delivery = mergeCronDelivery(draft.delivery, legacyDeliveryPatch);
    }
  }
  if (patch.delivery) {
    draft.delivery = mergeCronDelivery(draft.delivery, patch.delivery);
  }
  if (draft.sessionTarget === "main" && draft.delivery) {
    draft.delivery = undefined;
  }
  if (patch.state) {
    draft.state = { ...draft.state, ...patch.state };
  }
  if ("agentId" in patch) {
    draft.agentId = normalizeOptionalAgentId((patch as { agentId?: unknown }).agentId);
  }

  // Validate BEFORE applying to the real job.
  assertSupportedJobSpec(draft);
  assertDeliverySupport(draft);

  // Replace the job in the store array immutably.
  const index = state.store!.jobs.findIndex(j => j.id === id);
  if (index === -1) throw new Error("unknown cron job id");
  state.store!.jobs[index] = { ...draft, updatedAtMs: Date.now() };
  return state.store!.jobs[index];
}

function mergeCronPayload(existing: CronPayload, patch: CronPayloadPatch): CronPayload {
  if (patch.kind !== existing.kind) {
    return buildPayloadFromPatch(patch);
  }

  if (patch.kind === "systemEvent") {
    if (existing.kind !== "systemEvent") {
      return buildPayloadFromPatch(patch);
    }
    const text = typeof patch.text === "string" ? patch.text : existing.text;
    return { kind: "systemEvent", text };
  }

  if (existing.kind !== "agentTurn") {
    return buildPayloadFromPatch(patch);
  }

  const next: Extract<CronPayload, { kind: "agentTurn" }> = { ...existing };
  if (typeof patch.message === "string") {
    next.message = patch.message;
  }
  if (typeof patch.model === "string") {
    next.model = patch.model;
  }
  if (typeof patch.thinking === "string") {
    next.thinking = patch.thinking;
  }
  if (typeof patch.timeoutSeconds === "number" && Number.isFinite(patch.timeoutSeconds)) {
    next.timeoutSeconds = Math.max(1, Math.min(Math.floor(patch.timeoutSeconds), 3600));
  }
  if (typeof patch.deliver === "boolean") {
    next.deliver = patch.deliver;
  }
  if (typeof patch.channel === "string") {
    next.channel = patch.channel;
  }
  if (typeof patch.to === "string") {
    next.to = patch.to;
  }
  if (typeof patch.bestEffortDeliver === "boolean") {
    next.bestEffortDeliver = patch.bestEffortDeliver;
  }
  return next;
}

function buildLegacyDeliveryPatch(
  payload: Extract<CronPayloadPatch, { kind: "agentTurn" }>,
): CronDeliveryPatch | null {
  const deliver = payload.deliver;
  const toRaw = typeof payload.to === "string" ? payload.to.trim() : "";
  const hasLegacyHints =
    typeof deliver === "boolean" ||
    typeof payload.bestEffortDeliver === "boolean" ||
    Boolean(toRaw);
  if (!hasLegacyHints) {
    return null;
  }

  const patch: CronDeliveryPatch = {};
  let hasPatch = false;

  if (deliver === false) {
    patch.mode = "none";
    hasPatch = true;
  } else if (deliver === true || toRaw) {
    patch.mode = "announce";
    hasPatch = true;
  }

  if (typeof payload.channel === "string") {
    const channel = payload.channel.trim().toLowerCase();
    patch.channel = channel ? channel : undefined;
    hasPatch = true;
  }
  if (typeof payload.to === "string") {
    patch.to = payload.to.trim();
    hasPatch = true;
  }
  if (typeof payload.bestEffortDeliver === "boolean") {
    patch.bestEffort = payload.bestEffortDeliver;
    hasPatch = true;
  }

  return hasPatch ? patch : null;
}

function buildPayloadFromPatch(patch: CronPayloadPatch): CronPayload {
  if (patch.kind === "systemEvent") {
    if (typeof patch.text !== "string" || patch.text.length === 0) {
      throw new Error('cron.update payload.kind="systemEvent" requires text');
    }
    return { kind: "systemEvent", text: patch.text };
  }

  if (typeof patch.message !== "string" || patch.message.length === 0) {
    throw new Error('cron.update payload.kind="agentTurn" requires message');
  }

  const safeTimeout =
    typeof patch.timeoutSeconds === "number" && Number.isFinite(patch.timeoutSeconds)
      ? Math.max(1, Math.min(Math.floor(patch.timeoutSeconds), 3600))
      : undefined;

  return {
    kind: "agentTurn",
    message: patch.message,
    model: patch.model,
    thinking: patch.thinking,
    timeoutSeconds: safeTimeout,
    deliver: patch.deliver,
    channel: patch.channel,
    to: patch.to,
    bestEffortDeliver: patch.bestEffortDeliver,
  };
}

function mergeCronDelivery(
  existing: CronDelivery | undefined,
  patch: CronDeliveryPatch,
): CronDelivery {
  const next: CronDelivery = {
    mode: existing?.mode ?? "none",
    channel: existing?.channel,
    to: existing?.to,
    bestEffort: existing?.bestEffort,
  };

  if (typeof patch.mode === "string") {
    const VALID_MODES = new Set(["none", "announce"]);
    const normalized = (patch.mode as string) === "deliver" ? "announce" : patch.mode;
    next.mode = VALID_MODES.has(normalized) ? normalized : "none";
  }
  if ("channel" in patch) {
    const channel = typeof patch.channel === "string" ? patch.channel.trim() : "";
    next.channel = channel ? channel : undefined;
  }
  if ("to" in patch) {
    const to = typeof patch.to === "string" ? patch.to.trim() : "";
    next.to = to ? to : undefined;
  }
  if (typeof patch.bestEffort === "boolean") {
    next.bestEffort = patch.bestEffort;
  }

  return next;
}

export function isJobDue(job: CronJob, nowMs: number, opts: { forced: boolean }) {
  if (opts.forced) {
    return true;
  }
  return job.enabled && typeof job.state.nextRunAtMs === "number" && nowMs >= job.state.nextRunAtMs;
}

export function resolveJobPayloadTextForMain(job: CronJob): string | undefined {
  if (job.payload.kind !== "systemEvent") {
    return undefined;
  }
  const text = normalizePayloadToSystemText(job.payload);
  return text.trim() ? text : undefined;
}
