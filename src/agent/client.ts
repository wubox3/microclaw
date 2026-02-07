import Anthropic from "@anthropic-ai/sdk";
import type { AgentResponse, AgentStreamEvent } from "./types.js";
import type { AuthCredentials } from "../infra/auth.js";
import type { LlmClient, LlmSendParams, LlmStreamParams, LlmMessage } from "./llm-client.js";
import { createLogger } from "../logging.js";

const log = createLogger("anthropic-client");

export type AnthropicClientOptions = {
  auth: AuthCredentials;
  model?: string;
  maxTokens?: number;
};

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 4096;

const OAUTH_BETA_HEADERS = {
  "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
  "user-agent": "claude-cli/2.1.2 (external, cli)",
  "x-app": "cli",
};

function toAnthropicMessages(messages: LlmMessage[]): Anthropic.Messages.MessageParam[] {
  const result: Anthropic.Messages.MessageParam[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i]!;
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
      i++;
    } else if (msg.role === "assistant") {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const content: Anthropic.Messages.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }
        for (const tc of msg.toolCalls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.input as Record<string, unknown>,
          });
        }
        result.push({ role: "assistant", content });
      } else {
        result.push({ role: "assistant", content: msg.content });
      }
      i++;
    } else if (msg.role === "tool") {
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      while (i < messages.length && messages[i]!.role === "tool") {
        const toolMsg = messages[i] as Extract<LlmMessage, { role: "tool" }>;
        const block: Anthropic.Messages.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: toolMsg.toolCallId,
          content: toolMsg.content,
        };
        if (toolMsg.isError) {
          block.is_error = true;
        }
        toolResults.push(block);
        i++;
      }
      result.push({ role: "user", content: toolResults });
    } else {
      i++;
    }
  }
  return result;
}

export function createAnthropicClient(options: AnthropicClientOptions): LlmClient {
  const isOAuth = options.auth.isOAuth;

  const client = isOAuth
    ? new Anthropic({
        apiKey: "placeholder", // SDK requires a non-empty string even for OAuth
        authToken: options.auth.authToken,
        defaultHeaders: OAUTH_BETA_HEADERS,
      })
    : new Anthropic({ apiKey: options.auth.apiKey });

  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    async sendMessage(params: LlmSendParams): Promise<AgentResponse> {
      let system: string | Anthropic.Messages.TextBlockParam[] | undefined;
      if (isOAuth) {
        system = [
          { type: "text" as const, text: "You are Claude Code, Anthropic's official CLI for Claude." },
          ...(params.system ? [{ type: "text" as const, text: params.system }] : []),
        ];
      } else {
        system = params.system;
      }

      let response: Anthropic.Messages.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages: toAnthropicMessages(params.messages),
          tools: params.tools as Anthropic.Messages.Tool[] | undefined,
          temperature: params.temperature,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Anthropic API call failed: ${detail}`);
      }

      let text = "";
      const toolCalls: AgentResponse["toolCalls"] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          text += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      return {
        text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },

    // Note: streamMessage is designed for text-only display. It does NOT yield
    // tool_use events from the stream. If you need tool call handling, use
    // sendMessage instead which fully supports the tool-use loop.
    async *streamMessage(params: LlmStreamParams): AsyncGenerator<AgentStreamEvent> {
      if (params.tools && params.tools.length > 0) {
        log.warn("streamMessage does not support tool calls — tool definitions will be ignored. Use sendMessage for tool use.");
      }

      let system: string | Anthropic.Messages.TextBlockParam[] | undefined;
      if (isOAuth) {
        system = [
          { type: "text" as const, text: "You are Claude Code, Anthropic's official CLI for Claude." },
          ...(params.system ? [{ type: "text" as const, text: params.system }] : []),
        ];
      } else {
        system = params.system;
      }

      const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        system,
        messages: toAnthropicMessages(params.messages),
        tools: params.tools as Anthropic.Messages.Tool[] | undefined,
        temperature: params.temperature,
      });

      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta") {
            const delta = event.delta;
            if ("text" in delta) {
              yield { type: "text_delta", text: delta.text };
            }
          } else if (event.type === "message_start") {
            yield { type: "message_start" };
          } else if (event.type === "message_stop") {
            yield { type: "message_stop" };
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Anthropic stream failed: ${detail}`);
      }
    },
  };
}
