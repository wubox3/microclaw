import type { CronJobCreate, CronJobPatch } from "./types.js";
import {
  hasLegacyDeliveryHints,
  buildDeliveryFromLegacyPayload,
  stripLegacyDeliveryFields,
} from "./legacy-compat.js";
import { parseAbsoluteTimeMs } from "./parse.js";
import { migrateLegacyCronPayload } from "./payload-migration.js";

/** Inline sanitizeAgentId replacement. */
function sanitizeAgentId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
}

type UnknownRecord = Record<string, unknown>;

type NormalizeOptions = {
  applyDefaults?: boolean;
};

const DEFAULT_OPTIONS: NormalizeOptions = {
  applyDefaults: false,
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceSchedule(schedule: UnknownRecord) {
  const next: UnknownRecord = { ...schedule };
  const kind = typeof schedule.kind === "string" ? schedule.kind : undefined;
  const atMsRaw = schedule.atMs;
  const atRaw = schedule.at;
  const atString = typeof atRaw === "string" ? atRaw.trim() : "";
  const parsedAtMs =
    typeof atMsRaw === "number"
      ? atMsRaw
      : typeof atMsRaw === "string"
        ? parseAbsoluteTimeMs(atMsRaw)
        : atString
          ? parseAbsoluteTimeMs(atString)
          : null;

  if (!kind) {
    if (
      typeof schedule.atMs === "number" ||
      typeof schedule.at === "string" ||
      typeof schedule.atMs === "string"
    ) {
      next.kind = "at";
    } else if (typeof schedule.everyMs === "number") {
      next.kind = "every";
    } else if (typeof schedule.expr === "string") {
      next.kind = "cron";
    }
  }

  if (atString) {
    next.at = parsedAtMs ? new Date(parsedAtMs).toISOString() : atString;
  } else if (parsedAtMs !== null) {
    next.at = new Date(parsedAtMs).toISOString();
  }
  if ("atMs" in next) {
    delete next.atMs;
  }

  return next;
}

function coercePayload(payload: UnknownRecord) {
  const next: UnknownRecord = { ...payload };
  // Back-compat: older configs used `provider` for delivery channel.
  migrateLegacyCronPayload(next);
  return next;
}

function coerceDelivery(delivery: UnknownRecord) {
  const next: UnknownRecord = { ...delivery };
  if (typeof delivery.mode === "string") {
    const VALID_MODES = new Set(["none", "announce"]);
    const mode = delivery.mode.trim().toLowerCase();
    const normalized = mode === "deliver" ? "announce" : mode;
    next.mode = VALID_MODES.has(normalized) ? normalized : "none";
  }
  if (typeof delivery.channel === "string") {
    const trimmed = delivery.channel.trim().toLowerCase();
    if (trimmed) {
      next.channel = trimmed;
    } else {
      delete next.channel;
    }
  }
  if (typeof delivery.to === "string") {
    const trimmed = delivery.to.trim();
    if (trimmed) {
      next.to = trimmed;
    } else {
      delete next.to;
    }
  }
  return next;
}


function unwrapJob(raw: UnknownRecord) {
  if (isRecord(raw.data)) {
    return raw.data;
  }
  if (isRecord(raw.job)) {
    return raw.job;
  }
  return raw;
}

export function normalizeCronJobInput(
  raw: unknown,
  options: NormalizeOptions = DEFAULT_OPTIONS,
): UnknownRecord | null {
  if (!isRecord(raw)) {
    return null;
  }
  const base = unwrapJob(raw);
  const next: UnknownRecord = { ...base };

  if ("agentId" in base) {
    const agentId = base.agentId;
    if (agentId === null) {
      next.agentId = null;
    } else if (typeof agentId === "string") {
      const trimmed = agentId.trim();
      if (trimmed) {
        next.agentId = sanitizeAgentId(trimmed);
      } else {
        delete next.agentId;
      }
    }
  }

  if ("enabled" in base) {
    const enabled = base.enabled;
    if (typeof enabled === "boolean") {
      next.enabled = enabled;
    } else if (typeof enabled === "string") {
      const trimmed = enabled.trim().toLowerCase();
      if (trimmed === "true") {
        next.enabled = true;
      } else if (trimmed === "false") {
        next.enabled = false;
      }
    }
  }

  if (isRecord(base.schedule)) {
    next.schedule = coerceSchedule(base.schedule);
  }

  if (isRecord(base.payload)) {
    const coerced = coercePayload(base.payload);
    const { allowUnsafeExternalContent: _unsafe, ...safePayload } = coerced;
    next.payload = safePayload;
  }

  if (isRecord(base.delivery)) {
    next.delivery = coerceDelivery(base.delivery);
  }

  if (isRecord(base.isolation)) {
    delete next.isolation;
  }

  if (options.applyDefaults) {
    if (!next.wakeMode) {
      next.wakeMode = "next-heartbeat";
    }
    if (typeof next.enabled !== "boolean") {
      next.enabled = true;
    }
    if (!next.sessionTarget && isRecord(next.payload)) {
      const kind = typeof next.payload.kind === "string" ? next.payload.kind : "";
      if (kind === "systemEvent") {
        next.sessionTarget = "main";
      } else if (kind === "agentTurn") {
        next.sessionTarget = "isolated";
      }
    }
    if (
      "schedule" in next &&
      isRecord(next.schedule) &&
      next.schedule.kind === "at" &&
      !("deleteAfterRun" in next)
    ) {
      next.deleteAfterRun = true;
    }
    const payload = isRecord(next.payload) ? next.payload : null;
    const payloadKind = payload && typeof payload.kind === "string" ? payload.kind : "";
    const sessionTarget = typeof next.sessionTarget === "string" ? next.sessionTarget : "";
    const isIsolatedAgentTurn =
      sessionTarget === "isolated" || (sessionTarget === "" && payloadKind === "agentTurn");
    const hasDelivery = "delivery" in next && next.delivery !== undefined;
    const hasLegacyDelivery = payload ? hasLegacyDeliveryHints(payload) : false;
    if (!hasDelivery && isIsolatedAgentTurn && payloadKind === "agentTurn") {
      if (payload && hasLegacyDelivery) {
        next.delivery = buildDeliveryFromLegacyPayload(payload);
        next.payload = stripLegacyDeliveryFields(payload);
      } else {
        next.delivery = { mode: "announce" };
      }
    }
  }

  return next;
}

const CRON_JOB_CREATE_REQUIRED_KEYS: readonly string[] = [
  "name",
  "schedule",
  "payload",
  "sessionTarget",
  "wakeMode",
  "enabled",
];

export function normalizeCronJobCreate(
  raw: unknown,
  options?: NormalizeOptions,
): CronJobCreate | null {
  const result = normalizeCronJobInput(raw, {
    applyDefaults: true,
    ...options,
  });
  if (!result) {
    return null;
  }
  for (const key of CRON_JOB_CREATE_REQUIRED_KEYS) {
    if (!(key in result) || result[key] === undefined) {
      return null;
    }
  }
  return result as CronJobCreate;
}

export function normalizeCronJobPatch(
  raw: unknown,
  options?: NormalizeOptions,
): CronJobPatch | null {
  return normalizeCronJobInput(raw, {
    applyDefaults: false,
    ...options,
  }) as CronJobPatch | null;
}
