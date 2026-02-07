import type { Agent } from "../../agent/agent.js";
import type { WebMonitor } from "../../channels/web/monitor.js";
import type { CronJob } from "../types.js";
import { resolveCronDeliveryPlan } from "../delivery.js";
import { pickSummaryFromOutput } from "./helpers.js";

export type RunCronAgentTurnResult = {
  status: "ok" | "error" | "skipped";
  summary?: string;
  /** Last non-empty agent text output (not truncated). */
  outputText?: string;
  error?: string;
};

export type RunCronAgentTurnParams = {
  agent: Agent;
  job: CronJob;
  message: string;
  webMonitor?: WebMonitor;
};

/**
 * Simplified isolated agent execution for microclaw.
 *
 * OpenClaw's version has deep coupling to its session/workspace/CLI/delivery system.
 * For microclaw, we simply:
 * 1. Run agent.chat() with the job's message
 * 2. Capture response text
 * 3. Optionally broadcast result to web UI via webMonitor
 * 4. Return status/summary/error
 */
export async function runCronIsolatedAgentTurn(
  params: RunCronAgentTurnParams,
): Promise<RunCronAgentTurnResult> {
  const { agent, job, message, webMonitor } = params;

  if (job.payload.kind !== "agentTurn") {
    return {
      status: "skipped",
      error: 'isolated job requires payload.kind="agentTurn"',
    };
  }

  const now = Date.now();
  const commandBody = `[cron:${job.id} ${job.name}] ${message}`.trim();

  try {
    const response = await agent.chat({
      messages: [
        { role: "user", content: commandBody, timestamp: now },
      ],
      channelId: "cron",
    });

    const outputText = response.text?.trim() || undefined;
    const summary = pickSummaryFromOutput(outputText);

    // Broadcast to web UI if delivery is requested
    const deliveryPlan = resolveCronDeliveryPlan(job);
    if (deliveryPlan.requested && webMonitor && outputText) {
      webMonitor.broadcast(JSON.stringify({
        type: "channel_message",
        channelId: "cron",
        from: "assistant",
        text: outputText,
        timestamp: Date.now(),
        senderName: `Cron: ${job.name}`,
        isFromSelf: true,
      }));
    }

    return {
      status: "ok",
      summary,
      outputText,
    };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
