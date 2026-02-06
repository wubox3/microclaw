export type AgentMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  metadata?: {
    channelId?: string;
    sessionKey?: string;
    toolResults?: AgentToolResult[];
  };
};

export type AgentToolContext = {
  channelId: string;
};

export type AgentTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (params: Record<string, unknown>, context?: AgentToolContext) => Promise<AgentToolResult>;
};

export type AgentToolResult = {
  content: string;
  isError?: boolean;
};

export type AgentResponse = {
  text: string;
  toolCalls?: AgentToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

export type AgentToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AgentStreamEvent = {
  type: "text_delta" | "tool_use" | "message_start" | "message_stop";
  text?: string;
  toolCall?: AgentToolCall;
};
