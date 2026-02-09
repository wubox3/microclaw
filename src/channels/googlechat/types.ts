import type { Agent } from "../../agent/agent.js";
import type { WebMonitor } from "../web/monitor.js";
import type { MemorySearchManager } from "../../memory/types.js";
import type { EClawConfig } from "../../config/types.js";

export type GoogleChatGatewayParams = {
  readonly config: EClawConfig;
  readonly agent: Agent;
  readonly webMonitor: WebMonitor;
  readonly memoryManager?: MemorySearchManager;
};

export type GoogleChatGatewayHandle = {
  readonly stop: () => void;
};

export type GoogleChatSender = {
  readonly name: string;
  readonly displayName: string;
  readonly email?: string;
  readonly type: string;
};

export type GoogleChatThread = {
  readonly name: string;
};

export type GoogleChatSpace = {
  readonly name: string;
  readonly displayName?: string;
  readonly type?: string;
  readonly spaceType?: string;
};

export type GoogleChatMessage = {
  readonly name: string;
  readonly sender: GoogleChatSender;
  readonly createTime: string;
  readonly text?: string;
  readonly thread?: GoogleChatThread;
  readonly space: GoogleChatSpace;
  readonly argumentText?: string;
};

export type GoogleChatEvent = {
  readonly type: string;
  readonly eventTime: string;
  readonly message?: GoogleChatMessage;
  readonly space?: GoogleChatSpace;
  readonly user?: GoogleChatSender;
};

export type ServiceAccountCredentials = {
  readonly client_email: string;
  readonly private_key: string;
  readonly token_uri: string;
};
