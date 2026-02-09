import crypto from "node:crypto";

/**
 * Simplified cron session for eclaw.
 * Eclaw doesn't have openclaw's session store; we just generate a unique session ID.
 */
export function resolveCronSessionId(params: {
  jobId: string;
  nowMs: number;
}): string {
  return `cron-${params.jobId}-${crypto.randomUUID()}`;
}
