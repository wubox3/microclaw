import { describe, it, expect, vi, beforeEach } from "vitest";
import type OpenAI from "openai";
import { createOpenRouterClient } from "./openrouter-client.js";
import type { LlmClient } from "./llm-client.js";

// ---------------------------------------------------------------------------
// Mock the openai SDK
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockCreate } };
      constructor(public opts: Record<string, unknown>) {}
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCompletion(
  overrides: Partial<OpenAI.ChatCompletion> = {},
): OpenAI.ChatCompletion {
  return {
    id: "chatcmpl-123",
    object: "chat.completion",
    created: Date.now(),
    model: "anthropic/claude-sonnet-4-5-20250929",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Hello!", refusal: null },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
    ...overrides,
  } as OpenAI.ChatCompletion;
}

function makeToolCallCompletion(): OpenAI.ChatCompletion {
  return makeCompletion({
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: "call_abc",
              type: "function",
              function: {
                name: "memory_search",
                arguments: '{"query":"hello"}',
              },
            },
          ],
        },
        finish_reason: "tool_calls",
        logprobs: null,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createOpenRouterClient", () => {
  let client: LlmClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createOpenRouterClient({ apiKey: "sk-or-test-key" });
  });

  describe("sendMessage", () => {
    it("returns text from a basic completion", async () => {
      mockCreate.mockResolvedValueOnce(makeCompletion());

      const result = await client.sendMessage({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result.text).toBe("Hello!");
      expect(result.toolCalls).toBeUndefined();
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });

    it("passes system prompt as a system message", async () => {
      mockCreate.mockResolvedValueOnce(makeCompletion());

      await client.sendMessage({
        messages: [{ role: "user", content: "Hi" }],
        system: "You are helpful.",
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[0]).toEqual({
        role: "system",
        content: "You are helpful.",
      });
      expect(callArgs.messages[1]).toEqual({
        role: "user",
        content: "Hi",
      });
    });

    it("converts tool definitions to OpenAI format", async () => {
      mockCreate.mockResolvedValueOnce(makeCompletion());

      await client.sendMessage({
        messages: [{ role: "user", content: "search" }],
        tools: [
          {
            name: "memory_search",
            description: "Search memory",
            input_schema: {
              type: "object",
              properties: { query: { type: "string" } },
            },
          },
        ],
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.tools).toEqual([
        {
          type: "function",
          function: {
            name: "memory_search",
            description: "Search memory",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
            },
          },
        },
      ]);
    });

    it("does not send tools when array is empty", async () => {
      mockCreate.mockResolvedValueOnce(makeCompletion());

      await client.sendMessage({
        messages: [{ role: "user", content: "Hi" }],
        tools: [],
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.tools).toBeUndefined();
    });

    it("parses tool call responses", async () => {
      mockCreate.mockResolvedValueOnce(makeToolCallCompletion());

      const result = await client.sendMessage({
        messages: [{ role: "user", content: "search" }],
      });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: "call_abc",
        name: "memory_search",
        input: { query: "hello" },
      });
    });

    it("handles malformed tool call arguments gracefully", async () => {
      const completion = makeCompletion({
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              refusal: null,
              tool_calls: [
                {
                  id: "call_bad",
                  type: "function",
                  function: {
                    name: "broken_tool",
                    arguments: "not-valid-json{{{",
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
            logprobs: null,
          },
        ],
      });
      mockCreate.mockResolvedValueOnce(completion);

      const result = await client.sendMessage({
        messages: [{ role: "user", content: "test" }],
      });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].input).toEqual({});
      expect(result.toolCalls![0].name).toBe("broken_tool");
    });

    it("throws when API call fails", async () => {
      mockCreate.mockRejectedValueOnce(new Error("rate limit exceeded"));

      await expect(
        client.sendMessage({
          messages: [{ role: "user", content: "Hi" }],
        }),
      ).rejects.toThrow("OpenRouter API call failed: rate limit exceeded");
    });

    it("throws when no choices returned", async () => {
      mockCreate.mockResolvedValueOnce(makeCompletion({ choices: [] }));

      await expect(
        client.sendMessage({
          messages: [{ role: "user", content: "Hi" }],
        }),
      ).rejects.toThrow("OpenRouter returned no choices in response");
    });

    it("returns empty text when content is null", async () => {
      const completion = makeCompletion({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: null, refusal: null },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
      });
      mockCreate.mockResolvedValueOnce(completion);

      const result = await client.sendMessage({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result.text).toBe("");
    });

    it("handles response without usage data", async () => {
      const completion = makeCompletion();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (completion as any).usage = undefined;
      mockCreate.mockResolvedValueOnce(completion);

      const result = await client.sendMessage({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result.usage).toBeUndefined();
    });

    it("passes temperature to the API", async () => {
      mockCreate.mockResolvedValueOnce(makeCompletion());

      await client.sendMessage({
        messages: [{ role: "user", content: "Hi" }],
        temperature: 0.7,
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.7);
    });

    it("uses custom model and maxTokens from options", () => {
      const customClient = createOpenRouterClient({
        apiKey: "sk-or-test",
        model: "openai/gpt-4o",
        maxTokens: 2048,
      });

      mockCreate.mockResolvedValueOnce(makeCompletion());

      customClient.sendMessage({
        messages: [{ role: "user", content: "Hi" }],
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe("openai/gpt-4o");
      expect(callArgs.max_tokens).toBe(2048);
    });

    it("uses default model and maxTokens when not specified", async () => {
      mockCreate.mockResolvedValueOnce(makeCompletion());

      await client.sendMessage({
        messages: [{ role: "user", content: "Hi" }],
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe("anthropic/claude-sonnet-4-5-20250929");
      expect(callArgs.max_tokens).toBe(4096);
    });

    it("preserves message order with multiple messages", async () => {
      mockCreate.mockResolvedValueOnce(makeCompletion());

      await client.sendMessage({
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
          { role: "user", content: "How are you?" },
        ],
        system: "Be brief.",
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages).toEqual([
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "user", content: "How are you?" },
      ]);
    });
  });

  describe("streamMessage", () => {
    it("yields message_start, text deltas, and message_stop", async () => {
      const chunks = [
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: " world" } }] },
      ];

      mockCreate.mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        },
      });

      const events: Array<{ type: string; text?: string }> = [];
      for await (const event of client.streamMessage({
        messages: [{ role: "user", content: "Hi" }],
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "message_start" },
        { type: "text_delta", text: "Hello" },
        { type: "text_delta", text: " world" },
        { type: "message_stop" },
      ]);
    });

    it("skips chunks with no content", async () => {
      const chunks = [
        { choices: [{ delta: {} }] },
        { choices: [{ delta: { content: "data" } }] },
        { choices: [{ delta: { content: null } }] },
      ];

      mockCreate.mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        },
      });

      const events: Array<{ type: string; text?: string }> = [];
      for await (const event of client.streamMessage({
        messages: [{ role: "user", content: "Hi" }],
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "message_start" },
        { type: "text_delta", text: "data" },
        { type: "message_stop" },
      ]);
    });

    it("throws when stream creation fails", async () => {
      mockCreate.mockRejectedValueOnce(new Error("connection refused"));

      const gen = client.streamMessage({
        messages: [{ role: "user", content: "Hi" }],
      });

      await expect(gen.next()).rejects.toThrow(
        "OpenRouter stream failed: connection refused",
      );
    });

    it("passes stream:true to the API", async () => {
      mockCreate.mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          // empty stream
        },
      });

      // Consume the generator
      for await (const _ of client.streamMessage({
        messages: [{ role: "user", content: "Hi" }],
      })) {
        // no-op
      }

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.stream).toBe(true);
    });
  });
});
