import type { Agent } from "../../agent/agent.js";
import type { WebMonitor } from "../web/monitor.js";
import type { MemorySearchManager } from "../../memory/types.js";
import type { EClawConfig } from "../../config/types.js";

export type ImessageGatewayParams = {
  readonly config: EClawConfig;
  readonly agent: Agent;
  readonly webMonitor: WebMonitor;
  readonly memoryManager?: MemorySearchManager;
};

export type ImessageGatewayHandle = {
  readonly stop: () => void;
};

export type ImsgChat = {
  readonly chat_id: number;
  readonly display_name: string;
  readonly handle: string;
  readonly service: string;
  readonly last_message_date: string;
};

export type ImsgMessage = {
  readonly rowid: number;
  readonly guid: string;
  readonly text: string;
  readonly date: string;
  readonly is_from_me: boolean;
  readonly sender: string;
  readonly handle_id: string;
  readonly chat_id: number;
  readonly attachments?: ReadonlyArray<{ readonly filename: string; readonly mime_type: string }>;
};
