import type { AgentResponse, AgentStreamEvent } from "./types.js";

export type LlmToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type LlmSendParams = {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  system?: string;
  tools?: LlmToolDefinition[];
  temperature?: number;
};

export type LlmStreamParams = {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  system?: string;
  temperature?: number;
};

export type LlmClient = {
  sendMessage: (params: LlmSendParams) => Promise<AgentResponse>;
  streamMessage: (params: LlmStreamParams) => AsyncGenerator<AgentStreamEvent>;
};
