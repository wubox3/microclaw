import type { Agent } from "../../agent/agent.js";
import type { WebMonitor } from "../web/monitor.js";
import type { MemorySearchManager } from "../../memory/types.js";
import type { EClawConfig } from "../../config/types.js";

export type SignalGatewayParams = {
  readonly config: EClawConfig;
  readonly agent: Agent;
  readonly webMonitor: WebMonitor;
  readonly memoryManager?: MemorySearchManager;
};

export type SignalGatewayHandle = {
  readonly stop: () => void;
};

export type SignalJsonMessage = {
  readonly envelope?: {
    readonly source?: string;
    readonly sourceNumber?: string;
    readonly sourceName?: string;
    readonly sourceUuid?: string;
    readonly timestamp?: number;
    readonly dataMessage?: {
      readonly message?: string | null;
      readonly timestamp?: number;
      readonly groupInfo?: {
        readonly groupId?: string;
        readonly groupName?: string;
        readonly type?: string;
      };
    };
    readonly syncMessage?: {
      readonly sentMessage?: {
        readonly message?: string;
        readonly destination?: string;
        readonly timestamp?: number;
      };
    };
  };
  readonly account?: string;
};
