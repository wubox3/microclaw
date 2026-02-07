import type { CronService } from "../cron/service.js";
import { normalizeCronJobCreate, normalizeCronJobPatch } from "../cron/normalize.js";
import { readCronRunLogEntries, resolveCronRunLogPath } from "../cron/run-log.js";
import type { AgentTool, AgentToolResult } from "./types.js";

const CRON_ACTIONS = ["status", "list", "add", "update", "remove", "run", "runs", "wake"] as const;

function jsonResult(data: unknown): AgentToolResult {
  return { content: JSON.stringify(data, null, 2) };
}

function errorResult(message: string): AgentToolResult {
  return { content: message, isError: true };
}

function readString(params: Record<string, unknown>, key: string): string | undefined {
  const val = params[key];
  return typeof val === "string" ? val.trim() : undefined;
}

export function createCronTool(opts: {
  cronService: CronService;
  storePath: string;
}): AgentTool {
  const { cronService, storePath } = opts;

  return {
    name: "cron",
    description: `Manage cron jobs (status/list/add/update/remove/run/runs) and send wake events.

ACTIONS:
- status: Check cron scheduler status
- list: List jobs (use includeDisabled:true to include disabled)
- add: Create job (requires job object, see schema below)
- update: Modify job (requires jobId + patch object)
- remove: Delete job (requires jobId)
- run: Trigger job immediately (requires jobId)
- runs: Get job run history (requires jobId)
- wake: Send wake event (requires text, optional mode)

JOB SCHEMA (for add action):
{
  "name": "string",
  "schedule": { ... },
  "payload": { ... },
  "delivery": { ... },
  "sessionTarget": "main" | "isolated",
  "enabled": true | false
}

SCHEDULE TYPES (schedule.kind):
- "at": One-shot at absolute time
  { "kind": "at", "at": "<ISO-8601 timestamp>" }
- "every": Recurring interval
  { "kind": "every", "everyMs": <interval-ms>, "anchorMs": <optional-start-ms> }
- "cron": Cron expression
  { "kind": "cron", "expr": "<cron-expression>", "tz": "<optional-timezone>" }

PAYLOAD TYPES (payload.kind):
- "systemEvent": Injects text as system event into session
  { "kind": "systemEvent", "text": "<message>" }
- "agentTurn": Runs agent with message (isolated sessions only)
  { "kind": "agentTurn", "message": "<prompt>" }

DELIVERY (isolated-only, top-level):
  { "mode": "none|announce", "channel": "<optional>", "to": "<optional>", "bestEffort": <optional-bool> }

CRITICAL CONSTRAINTS:
- sessionTarget="main" REQUIRES payload.kind="systemEvent"
- sessionTarget="isolated" REQUIRES payload.kind="agentTurn"

WAKE MODES (for wake action):
- "next-heartbeat" (default): Wake on next heartbeat
- "now": Wake immediately`,
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...CRON_ACTIONS],
          description: "The cron action to perform",
        },
        includeDisabled: {
          type: "boolean",
          description: "For list: include disabled jobs",
        },
        job: {
          type: "object",
          description: "For add: the job definition",
        },
        jobId: {
          type: "string",
          description: "For update/remove/run/runs: the job ID",
        },
        id: {
          type: "string",
          description: "Alias for jobId (backward compatibility)",
        },
        patch: {
          type: "object",
          description: "For update: the patch to apply",
        },
        text: {
          type: "string",
          description: "For wake: the wake event text",
        },
        mode: {
          type: "string",
          enum: ["now", "next-heartbeat"],
          description: "For wake: the wake mode",
        },
      },
      required: ["action"],
    },
    execute: async (params) => {
      const action = readString(params, "action");
      if (!action || !CRON_ACTIONS.includes(action as typeof CRON_ACTIONS[number])) {
        return errorResult(`Unknown action: ${action}. Valid: ${CRON_ACTIONS.join(", ")}`);
      }

      try {
        switch (action) {
          case "status":
            return jsonResult(await cronService.status());

          case "list":
            return jsonResult(
              await cronService.list({
                includeDisabled: Boolean(params.includeDisabled),
              }),
            );

          case "add": {
            if (!params.job || typeof params.job !== "object") {
              return errorResult("job object required for add action");
            }
            const job = normalizeCronJobCreate(params.job);
            if (!job) {
              return errorResult("Invalid job definition: normalization failed. Ensure the job object has valid schedule and payload fields.");
            }
            const result = await cronService.add(job);
            return jsonResult(result);
          }

          case "update": {
            const id = readString(params, "jobId") ?? readString(params, "id");
            if (!id) {
              return errorResult("jobId required for update action");
            }
            if (!params.patch || typeof params.patch !== "object") {
              return errorResult("patch object required for update action");
            }
            const patch = normalizeCronJobPatch(params.patch);
            if (!patch) {
              return errorResult("Invalid patch definition: normalization failed. Ensure the patch object is valid.");
            }
            const result = await cronService.update(id, patch);
            return jsonResult(result);
          }

          case "remove": {
            const id = readString(params, "jobId") ?? readString(params, "id");
            if (!id) {
              return errorResult("jobId required for remove action");
            }
            const result = await cronService.remove(id);
            return jsonResult(result);
          }

          case "run": {
            const id = readString(params, "jobId") ?? readString(params, "id");
            if (!id) {
              return errorResult("jobId required for run action");
            }
            const result = await cronService.run(id, "force");
            return jsonResult(result);
          }

          case "runs": {
            const id = readString(params, "jobId") ?? readString(params, "id");
            if (!id) {
              return errorResult("jobId required for runs action");
            }
            const logPath = resolveCronRunLogPath({ storePath, jobId: id });
            const entries = await readCronRunLogEntries(logPath, { jobId: id, limit: 50 });
            return jsonResult(entries);
          }

          case "wake": {
            const text = readString(params, "text");
            if (!text) {
              return errorResult("text required for wake action");
            }
            const mode =
              params.mode === "now" || params.mode === "next-heartbeat"
                ? params.mode
                : "next-heartbeat";
            const result = await cronService.wake({ mode: mode as "now" | "next-heartbeat", text });
            return jsonResult(result);
          }

          default:
            return errorResult(`Unknown action: ${action}`);
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  };
}
