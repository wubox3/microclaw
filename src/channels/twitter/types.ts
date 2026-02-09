import type { Agent } from "../../agent/agent.js";
import type { WebMonitor } from "../web/monitor.js";
import type { MemorySearchManager } from "../../memory/types.js";
import type { EClawConfig } from "../../config/types.js";

export type TwitterGatewayParams = {
  readonly config: EClawConfig;
  readonly agent: Agent;
  readonly webMonitor: WebMonitor;
  readonly memoryManager?: MemorySearchManager;
};

export type TwitterGatewayHandle = {
  readonly stop: () => void;
};

export type BirdMention = {
  readonly id: string;
  readonly url: string;
  readonly text: string;
  readonly author: {
    readonly handle: string;
    readonly name: string;
  };
  readonly created_at: string;
  readonly in_reply_to_id?: string;
};
