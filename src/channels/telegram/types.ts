import type { Agent } from "../../agent/agent.js";
import type { WebMonitor } from "../web/monitor.js";
import type { MemorySearchManager } from "../../memory/types.js";
import type { EClawConfig } from "../../config/types.js";

export type TelegramGatewayParams = {
  readonly config: EClawConfig;
  readonly agent: Agent;
  readonly webMonitor: WebMonitor;
  readonly memoryManager?: MemorySearchManager;
};

export type TelegramGatewayHandle = {
  readonly stop: () => void;
};

export type TelegramUpdate = {
  readonly update_id: number;
  readonly message?: {
    readonly message_id: number;
    readonly from?: {
      readonly id: number;
      readonly is_bot: boolean;
      readonly first_name: string;
      readonly last_name?: string;
      readonly username?: string;
    };
    readonly chat: {
      readonly id: number;
      readonly first_name?: string;
      readonly last_name?: string;
      readonly username?: string;
      readonly type: "private" | "group" | "supergroup" | "channel";
    };
    readonly date: number;
    readonly text?: string;
    readonly caption?: string;
  };
};

export type TelegramApiResponse<T> = {
  readonly ok: boolean;
  readonly result?: T;
  readonly description?: string;
};
