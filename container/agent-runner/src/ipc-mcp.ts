/**
 * IPC-based MCP Server for EClaw
 * Writes messages to files for the host process to pick up via polling
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import fs from "fs";
import path from "path";

const IPC_DIR = "/workspace/ipc";
const MESSAGES_DIR = path.join(IPC_DIR, "messages");

export interface IpcMcpContext {
  channelId: string;
  chatId?: string;
}

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

export function createIpcMcp(ctx: IpcMcpContext) {
  const { channelId, chatId } = ctx;

  return createSdkMcpServer({
    name: "eclaw",
    version: "1.0.0",
    tools: [
      tool(
        "send_message",
        "Send a message to the current channel. Use this to proactively share information or updates with the user.",
        {
          text: z.string().describe("The message text to send"),
        },
        async (args) => {
          const data = {
            type: "message",
            channelId,
            chatId,
            text: args.text,
            timestamp: new Date().toISOString(),
          };

          const filename = writeIpcFile(MESSAGES_DIR, data);

          return {
            content: [
              {
                type: "text" as const,
                text: `Message queued for delivery (${filename})`,
              },
            ],
          };
        },
      ),

      tool(
        "list_channels",
        "List available channels and their status.",
        {},
        async () => {
          const channelsFile = path.join(IPC_DIR, "channels.json");

          try {
            if (!fs.existsSync(channelsFile)) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Current channel: ${channelId}. No additional channel info available.`,
                  },
                ],
              };
            }

            const channels = fs.readFileSync(channelsFile, "utf-8");
            return {
              content: [
                {
                  type: "text" as const,
                  text: channels,
                },
              ],
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error reading channels: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
            };
          }
        },
      ),

      tool(
        "search_memory",
        "Search the memory system for relevant past conversations, facts, or context.",
        {
          query: z.string().describe("The search query"),
          limit: z
            .number()
            .optional()
            .describe("Maximum number of results (default: 5)"),
        },
        async (args) => {
          const data = {
            type: "search_memory",
            query: args.query,
            limit: args.limit ?? 5,
            channelId,
            timestamp: new Date().toISOString(),
          };

          // Write search request and wait for result via snapshot file
          const tasksDir = path.join(IPC_DIR, "tasks");
          const filename = writeIpcFile(tasksDir, data);
          const resultFile = path.join(
            tasksDir,
            filename.replace(".json", ".result.json"),
          );

          // Poll for result (host processes the task and writes result)
          const maxWait = 10000;
          const pollInterval = 200;
          let waited = 0;

          while (waited < maxWait) {
            if (fs.existsSync(resultFile)) {
              try {
                const result = JSON.parse(
                  fs.readFileSync(resultFile, "utf-8"),
                );
                fs.unlinkSync(resultFile);
                return {
                  content: [
                    {
                      type: "text" as const,
                      text:
                        result.results?.length > 0
                          ? JSON.stringify(result.results, null, 2)
                          : "No relevant memories found.",
                    },
                  ],
                };
              } catch {
                // Result file exists but couldn't be read, retry
              }
            }
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            waited += pollInterval;
          }

          return {
            content: [
              {
                type: "text" as const,
                text: "Memory search timed out. The host may not have processed the request in time.",
              },
            ],
          };
        },
      ),
    ],
  });
}
