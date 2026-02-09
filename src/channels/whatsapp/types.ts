import type { Agent } from "../../agent/agent.js";
import type { WebMonitor } from "../web/monitor.js";
import type { MemorySearchManager } from "../../memory/types.js";
import type { EClawConfig } from "../../config/types.js";

export type WhatsAppGatewayParams = {
  readonly config: EClawConfig;
  readonly agent: Agent;
  readonly webMonitor: WebMonitor;
  readonly memoryManager?: MemorySearchManager;
};

export type WhatsAppGatewayHandle = {
  readonly stop: () => void;
};

export type ParsedMessage = {
  readonly from: string;
  readonly text: string;
  readonly chatId: string;
  readonly senderName: string;
  readonly timestamp: number;
};
