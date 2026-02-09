import type { Agent } from "../../agent/agent.js";
import type { WebMonitor } from "../web/monitor.js";
import type { MemorySearchManager } from "../../memory/types.js";
import type { EClawConfig } from "../../config/types.js";

export type SlackGatewayParams = {
  readonly config: EClawConfig;
  readonly agent: Agent;
  readonly webMonitor: WebMonitor;
  readonly memoryManager?: MemorySearchManager;
};

export type SlackGatewayHandle = {
  readonly stop: () => void;
};

export type SlackApiResponse<T> = {
  readonly ok: boolean;
  readonly error?: string;
} & T;

export type SlackMessage = {
  readonly type?: string;
  readonly subtype?: string;
  readonly user?: string;
  readonly bot_id?: string;
  readonly text?: string;
  readonly ts: string;
  readonly thread_ts?: string;
};

export type SlackConversation = {
  readonly id: string;
  readonly name?: string;
  readonly is_im?: boolean;
  readonly is_mpim?: boolean;
  readonly is_member?: boolean;
  readonly is_channel?: boolean;
  readonly is_group?: boolean;
  readonly user?: string;
};
