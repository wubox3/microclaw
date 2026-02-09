import OpenAI from "openai";
import type { AgentResponse, AgentStreamEvent } from "./types.js";
import type { LlmClient, LlmSendParams, LlmStreamParams, LlmToolDefinition } from "./llm-client.js";
import { createLogger } from "../logging.js";

const log = createLogger("openrouter");

export type OpenRouterClientOptions = {
  apiKey: string;
  model?: string;
  maxTokens?: number;
};

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 4096;

function toOpenAITools(
  tools: LlmToolDefinition[],
): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function buildMessages(
  params: LlmSendParams | LlmStreamParams,
): OpenAI.ChatCompletionMessageParam[] {
  const messages: OpenAI.ChatCompletionMessageParam[] = [];

  if (params.system) {
    messages.push({ role: "system", content: params.system });
  }

  for (const m of params.messages) {
    if (m.role === "tool") {
      messages.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content,
      });
    } else if (m.role === "assistant") {
      if (m.toolCalls && m.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          })),
        });
      } else {
        messages.push({ role: "assistant", content: m.content });
      }
    } else {
      messages.push({ role: "user", content: m.content });
    }
  }

  return messages;
}

export function createOpenRouterClient(
  options: OpenRouterClientOptions,
): LlmClient {
  const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: options.apiKey,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/wubox3/eclaw",
      "X-Title": "EClaw",
    },
  });

  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    async sendMessage(params: LlmSendParams): Promise<AgentResponse> {
      const messages = buildMessages(params);
      const tools =
        params.tools && params.tools.length > 0
          ? toOpenAITools(params.tools)
          : undefined;

      let response: OpenAI.ChatCompletion;
      try {
        response = await client.chat.completions.create({
          model,
          max_tokens: maxTokens,
          messages,
          tools,
          temperature: params.temperature,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`OpenRouter API call failed: ${detail}`);
      }

      const choice = response.choices[0];
      if (!choice) {
        throw new Error("OpenRouter returned no choices in response");
      }

      const message = choice.message;
      const text = message.content ?? "";

      const toolCalls = message.tool_calls
        ?.filter((tc): tc is Extract<typeof tc, { type: "function" }> => tc.type === "function")
        .map((tc) => {
          let input: Record<string, unknown>;
          try {
            input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            log.warn(`Failed to parse tool call arguments for ${tc.function.name}`);
            input = {};
          }
          return { id: tc.id, name: tc.function.name, input };
        });

      return {
        text,
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        usage: response.usage
          ? {
              inputTokens: response.usage.prompt_tokens ?? 0,
              outputTokens: response.usage.completion_tokens ?? 0,
            }
          : undefined,
      };
    },

    // Note: streamMessage does not support tool calls — use sendMessage for tool use.
    // Tool_use events are not yielded from the stream. Any tool definitions
    // passed will be ignored.
    async *streamMessage(
      params: LlmStreamParams,
    ): AsyncGenerator<AgentStreamEvent> {
      if (params.tools && params.tools.length > 0) {
        log.warn("streamMessage does not support tool calls — tool definitions will be ignored. Use sendMessage for tool use.");
      }

      const messages = buildMessages(params);

      let stream: AsyncIterable<OpenAI.ChatCompletionChunk>;
      try {
        stream = await client.chat.completions.create({
          model,
          max_tokens: maxTokens,
          messages,
          temperature: params.temperature,
          stream: true,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`OpenRouter stream failed: ${detail}`);
      }

      yield { type: "message_start" };

      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            yield { type: "text_delta", text: delta.content };
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log.error(`OpenRouter stream iteration failed: ${detail}`);
        // Yield message_stop so consumers know the stream is done
        yield { type: "message_stop" };
        return;
      }

      yield { type: "message_stop" };
    },
  };
}
