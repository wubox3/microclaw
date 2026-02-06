import type { MicroClawConfig } from "../config/types.js";
import type { MemorySearchResult } from "../memory/types.js";

const BASE_SYSTEM_PROMPT = `You are MicroClaw, a helpful AI assistant that can communicate across multiple messaging channels.

You have access to a memory system that stores relevant context from past conversations and files.
When memory results are provided, use them to give more informed and contextual responses.

Be concise, helpful, and friendly. Format responses appropriately for the channel you're communicating through.`;

export function buildSystemPrompt(params: {
  config: MicroClawConfig;
  memoryResults?: MemorySearchResult[];
  channelId?: string;
}): string {
  const parts: string[] = [];

  // Base prompt or custom prompt
  parts.push(params.config.agent?.systemPrompt ?? BASE_SYSTEM_PROMPT);

  // Channel context
  if (params.channelId) {
    parts.push(`\nCurrent channel: ${params.channelId}`);
  }

  // Memory context
  if (params.memoryResults && params.memoryResults.length > 0) {
    parts.push("\n--- Relevant Memory Context ---");
    for (const result of params.memoryResults.slice(0, 5)) {
      parts.push(`[${result.filePath}:${result.startLine}] ${result.snippet}`);
    }
    parts.push("--- End Memory Context ---");
  }

  return parts.join("\n");
}
