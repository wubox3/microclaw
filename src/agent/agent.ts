import type { MicroClawConfig } from "../config/types.js";
import type { AuthCredentials } from "../infra/auth.js";
import type { MemorySearchManager } from "../memory/types.js";
import type { AgentMessage, AgentResponse, AgentTool } from "./types.js";
import type { LlmClient } from "./llm-client.js";
import { createLlmClient } from "./create-client.js";
import { buildSystemPrompt } from "./prompt.js";
import { createMemorySearchTool, createChannelListTool } from "./tools.js";
import { runContainerAgent } from "../container/runner.js";
import type { ContainerConfig } from "../container/types.js";
import { createLogger } from "../logging.js";

const log = createLogger("agent");

export type AgentContext = {
  config: MicroClawConfig;
  auth: AuthCredentials;
  memoryManager?: MemorySearchManager;
  additionalTools?: AgentTool[];
  containerEnabled?: boolean;
  sessions?: Map<string, string>;
};

export type Agent = {
  chat: (params: {
    messages: AgentMessage[];
    channelId?: string;
  }) => Promise<AgentResponse>;
};

export function createAgent(context: AgentContext): Agent {
  const client = createLlmClient({
    config: context.config,
    auth: context.auth,
  });

  const tools: AgentTool[] = [
    createChannelListTool(),
    ...(context.additionalTools ?? []),
  ];

  if (context.memoryManager) {
    tools.push(createMemorySearchTool(context.memoryManager));
  }

  // Session tracking for container mode (channelId -> sessionId)
  const sessions = context.sessions ?? new Map<string, string>();

  return {
    chat: async ({ messages, channelId }) => {
      // Container mode: spawn Docker container with Claude Agent SDK
      if (context.containerEnabled) {
        return runContainerChat({
          messages,
          channelId: channelId ?? "web",
          config: context.config,
          sessions,
        });
      }

      // Direct mode: Anthropic API (fallback)
      return runDirectChat({ messages, channelId, client, tools, context });
    },
  };
}

async function runContainerChat(params: {
  messages: AgentMessage[];
  channelId: string;
  config: MicroClawConfig;
  sessions: Map<string, string>;
}): Promise<AgentResponse> {
  const { messages, channelId, config, sessions } = params;

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) {
    return { text: "No user message found." };
  }

  const containerConfig: ContainerConfig = {
    enabled: true,
    image: config.container?.image,
    timeout: config.container?.timeout,
    additionalMounts: config.container?.additionalMounts,
  };

  const sessionId = sessions.get(channelId);

  const output = await runContainerAgent(
    {
      prompt: lastUserMessage.content,
      sessionId,
      channelId,
    },
    containerConfig,
  );

  // Track session for conversation continuity
  if (output.newSessionId) {
    sessions.set(channelId, output.newSessionId);
  }

  if (output.status === "error") {
    log.error(`Container agent error: ${output.error}`);
    return {
      text: output.error ?? "Container agent encountered an error.",
    };
  }

  return {
    text: output.result ?? "No response from agent.",
  };
}

async function runDirectChat(params: {
  messages: AgentMessage[];
  channelId?: string;
  client: LlmClient;
  tools: AgentTool[];
  context: AgentContext;
}): Promise<AgentResponse> {
  const { messages, channelId, client, tools, context } = params;

  // Search memory for context if available
  let memoryResults: import("../memory/types.js").MemorySearchResult[] | undefined;
  if (context.memoryManager && messages.length > 0) {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMessage) {
      try {
        memoryResults = await context.memoryManager.search({
          query: lastUserMessage.content,
          limit: 5,
        });
      } catch {
        // Memory search failure is non-fatal
      }
    }
  }

  const systemPrompt = buildSystemPrompt({
    config: context.config,
    memoryResults,
    channelId,
  });

  const apiMessages = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const toolDefs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  // Initial response
  let response = await client.sendMessage({
    messages: apiMessages,
    system: systemPrompt,
    tools: toolDefs.length > 0 ? toolDefs : undefined,
    temperature: context.config.agent?.temperature,
  });

  // Handle tool calls in a loop (max 5 iterations)
  let iterations = 0;
  while (response.toolCalls && response.toolCalls.length > 0 && iterations < 5) {
    iterations++;
    const toolResults: string[] = [];

    for (const toolCall of response.toolCalls) {
      const tool = tools.find((t) => t.name === toolCall.name);
      if (tool) {
        const result = await tool.execute(toolCall.input);
        toolResults.push(`[Tool: ${toolCall.name}]\n${result.content}`);
      } else {
        toolResults.push(`[Tool: ${toolCall.name}] Unknown tool`);
      }
    }

    // Send tool results back
    const updatedMessages = [
      ...apiMessages,
      { role: "assistant" as const, content: response.text || "I'll use some tools to help answer that." },
      { role: "user" as const, content: `Tool results:\n${toolResults.join("\n\n")}` },
    ];

    response = await client.sendMessage({
      messages: updatedMessages,
      system: systemPrompt,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      temperature: context.config.agent?.temperature,
    });
  }

  return response;
}
