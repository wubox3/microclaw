import type { MemorySearchManager } from "../memory/types.js";
import type { AgentTool } from "./types.js";

export function createMemorySearchTool(memoryManager: MemorySearchManager): AgentTool {
  return {
    name: "memory_search",
    description: "Search through memory for relevant context, past conversations, and stored files. Use this when you need to recall information or find relevant context.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant memory chunks",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 5)",
        },
      },
      required: ["query"],
    },
    execute: async (params) => {
      try {
        const results = await memoryManager.search({
          query: String(params.query),
          limit: typeof params.limit === "number" ? Math.max(1, Math.min(100, Math.floor(params.limit))) : 5,
        });

        if (results.length === 0) {
          return { content: "No relevant memory found for this query." };
        }

        const formatted = results.map((r) =>
          `[${r.filePath}:${r.startLine}-${r.endLine}] (score: ${r.combinedScore.toFixed(3)})\n${r.snippet}`
        ).join("\n\n");

        return { content: formatted };
      } catch (err) {
        return {
          content: `Memory search error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };
}

export function createChannelListTool(): AgentTool {
  return {
    name: "list_channels",
    description: "List all available messaging channels and their capabilities.",
    input_schema: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      try {
        // Import dynamically to avoid circular deps
        const { listChatChannels } = await import("../channels/registry.js");
        const channels = listChatChannels();
        const formatted = channels.map((ch) =>
          `- ${ch.label}: ${ch.blurb ?? "Available"}`
        ).join("\n");
        return { content: `Available channels:\n${formatted}` };
      } catch (err) {
        return {
          content: `Failed to list channels: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };
}
