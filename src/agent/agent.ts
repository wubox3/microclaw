import type { MicroClawConfig } from "../config/types.js";
import type { AuthCredentials } from "../infra/auth.js";
import type { MemorySearchManager, UserProfile } from "../memory/types.js";
import type { AgentMessage, AgentResponse, AgentTool } from "./types.js";
import type { LlmClient, LlmMessage } from "./llm-client.js";
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
  canvasEnabled?: boolean;
  sessions?: Map<string, string>;
};

export type Agent = {
  chat: (params: {
    messages: AgentMessage[];
    channelId?: string;
  }) => Promise<AgentResponse>;
  addTool: (tool: AgentTool) => void;
};

export function createAgent(context: AgentContext): Agent {
  const client = createLlmClient({
    config: context.config,
    auth: context.auth,
  });

  let currentTools: AgentTool[] = [
    createChannelListTool(),
    ...(context.additionalTools ?? []),
    ...(context.memoryManager ? [createMemorySearchTool(context.memoryManager)] : []),
  ];

  // Session tracking for container mode (channelId -> sessionId)
  const sessions = context.sessions ?? new Map<string, string>();
  const channelLocks = new Map<string, Promise<AgentResponse>>();

  return {
    addTool: (tool: AgentTool) => {
      currentTools = [...currentTools, tool];
    },
    chat: async ({ messages, channelId }) => {
      // Container mode: spawn Docker container with Claude Agent SDK
      if (context.containerEnabled) {
        const cid = channelId ?? "web";
        const previous = channelLocks.get(cid) ?? Promise.resolve({} as AgentResponse);
        const current = previous
          .catch((err) => {
            log.warn(`Previous request for channel ${cid} failed: ${err instanceof Error ? err.message : String(err)}`);
          })
          .then(() =>
            runContainerChat({
              messages,
              channelId: cid,
              config: context.config,
              sessions,
            })
          )
          .finally(() => {
            // Only delete if we're still the latest entry to avoid orphaning downstream chains
            if (channelLocks.get(cid) === current) {
              channelLocks.delete(cid);
            }
            // Periodic cleanup: if the lock map grows too large, clear settled entries
            const MAX_CHANNEL_LOCKS = 1000;
            if (channelLocks.size > MAX_CHANNEL_LOCKS) {
              for (const [key, promise] of channelLocks) {
                // Check if promise has settled by racing with an already-resolved value
                Promise.race([promise, Promise.resolve("__settled__")]).then((v) => {
                  if (v === "__settled__") return;
                  channelLocks.delete(key);
                }).catch(() => {
                  channelLocks.delete(key);
                });
              }
            }
          });
        channelLocks.set(cid, current);
        return current;
      }

      // Direct mode: Anthropic API (fallback)
      // Snapshot tools at call time to avoid mutation during iteration
      const toolsSnapshot = [...currentTools];
      // Read user profile (non-blocking, undefined if unavailable)
      let userProfile: UserProfile | undefined;
      try {
        userProfile = context.memoryManager?.getUserProfile();
      } catch {
        // graceful degradation - continue without profile
      }
      return runDirectChat({ messages, channelId, client, tools: toolsSnapshot, context, userProfile });
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
    // Delete and re-insert to maintain LRU ordering in Map
    sessions.delete(channelId);
    sessions.set(channelId, output.newSessionId);
    // Evict oldest entries if sessions map exceeds limit to prevent memory leak
    const MAX_SESSIONS = 10000;
    if (sessions.size > MAX_SESSIONS) {
      const firstKey = sessions.keys().next().value;
      if (firstKey !== undefined) {
        sessions.delete(firstKey);
      }
    }
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
  userProfile?: UserProfile;
}): Promise<AgentResponse> {
  const { messages, channelId, client, tools, context, userProfile } = params;

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
      } catch (err) {
        // Memory search failure is non-fatal but worth logging
        log.warn(`Memory search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const systemPrompt = buildSystemPrompt({
    config: context.config,
    memoryResults,
    channelId,
    canvasEnabled: context.canvasEnabled,
    userProfile,
  });

  const systemMessages = messages.filter((m) => m.role === "system");
  if (systemMessages.length > 0) {
    log.warn(`Dropping ${systemMessages.length} system-role message(s) — system messages are not supported in direct chat mode`);
  }

  const llmMessages: LlmMessage[] = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
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
    messages: llmMessages,
    system: systemPrompt,
    tools: toolDefs.length > 0 ? toolDefs : undefined,
    temperature: context.config.agent?.temperature,
  });

  // Handle tool calls in a loop, preserving full conversation
  const conversationMessages: LlmMessage[] = [...llmMessages];
  const MAX_TOOL_ITERATIONS = 25;
  let iterations = 0;
  const MAX_CONVERSATION_MESSAGES = 100;
  while (response.toolCalls && response.toolCalls.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    if (conversationMessages.length > MAX_CONVERSATION_MESSAGES) {
      break;
    }

    // Append assistant message with its tool calls
    conversationMessages.push({
      role: "assistant",
      content: response.text || "",
      toolCalls: response.toolCalls,
    });

    // Execute tools in parallel and append all results
    const toolContext = { channelId: channelId ?? "web" };
    const settled = await Promise.allSettled(
      response.toolCalls.map(async (toolCall) => {
        const tool = tools.find((t) => t.name === toolCall.name);
        if (!tool) {
          return { toolCallId: toolCall.id, content: "Unknown tool: " + toolCall.name, isError: true };
        }
        try {
          const result = await tool.execute(toolCall.input, toolContext);
          return { toolCallId: toolCall.id, content: result.content, isError: result.isError ?? false };
        } catch (err) {
          return { toolCallId: toolCall.id, content: err instanceof Error ? err.message : String(err), isError: true };
        }
      })
    );
    for (const entry of settled) {
      const result = entry.status === "fulfilled"
        ? entry.value
        : { toolCallId: "unknown", content: String(entry.reason), isError: true };
      conversationMessages.push({
        role: "tool",
        toolCallId: result.toolCallId,
        content: result.content,
        isError: result.isError,
      });
    }

    // Break early if conversation messages exceed safety limit after appending tool results
    if (conversationMessages.length > MAX_CONVERSATION_MESSAGES * 2) break;

    response = await client.sendMessage({
      messages: conversationMessages,
      system: systemPrompt,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      temperature: context.config.agent?.temperature,
    });
  }

  if (iterations >= MAX_TOOL_ITERATIONS && response.toolCalls && response.toolCalls.length > 0) {
    log.warn(`Tool call loop reached max ${MAX_TOOL_ITERATIONS} iterations with ${response.toolCalls.length} unprocessed tool calls`);
    return {
      ...response,
      text: (response.text || "") + "\n\n[Note: reached maximum tool call iterations. Some tool calls were not executed.]",
      toolCalls: undefined,
    };
  }

  return response;
}
