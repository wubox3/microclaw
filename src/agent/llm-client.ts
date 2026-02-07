import type { AgentResponse, AgentStreamEvent, AgentToolCall } from "./types.js";

export type LlmToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type LlmUserMessage = { role: "user"; content: string };
export type LlmAssistantMessage = { role: "assistant"; content: string; toolCalls?: AgentToolCall[] };
export type LlmToolResultMessage = { role: "tool"; toolCallId: string; content: string; isError?: boolean };
export type LlmMessage = LlmUserMessage | LlmAssistantMessage | LlmToolResultMessage;

export type LlmParams = {
  messages: LlmMessage[];
  system?: string;
  tools?: LlmToolDefinition[];
  temperature?: number;
};

export type LlmSendParams = LlmParams;
export type LlmStreamParams = LlmParams;

export type LlmClient = {
  sendMessage: (params: LlmSendParams) => Promise<AgentResponse>;
  streamMessage: (params: LlmStreamParams) => AsyncGenerator<AgentStreamEvent>;
};
