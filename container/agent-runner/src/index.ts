/**
 * MicroClaw Agent Runner
 * Runs inside a Docker container, receives config via stdin, outputs result to stdout
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { createIpcMcp } from "./ipc-mcp.js";

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  channelId: string;
  chatId?: string;
}

interface ContainerOutput {
  status: "success" | "error";
  result: string | null;
  newSessionId?: string;
  error?: string;
}

const OUTPUT_START_MARKER = "---MICROCLAW_OUTPUT_START---";
const OUTPUT_END_MARKER = "---MICROCLAW_OUTPUT_END---";

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

async function main(): Promise<void> {
  let input: ContainerInput;

  try {
    const stdinData = await readStdin();
    input = JSON.parse(stdinData);
    log(`Received input for channel: ${input.channelId}`);
  } catch (err) {
    writeOutput({
      status: "error",
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
  }

  const ipcMcp = createIpcMcp({
    channelId: input.channelId,
    chatId: input.chatId,
  });

  let result: string | null = null;
  let newSessionId: string | undefined;

  try {
    log("Starting agent...");

    for await (const message of query({
      prompt: input.prompt,
      options: {
        cwd: "/workspace/group",
        resume: input.sessionId,
        allowedTools: [
          "Bash",
          "Read",
          "Write",
          "Edit",
          "Glob",
          "Grep",
          "WebSearch",
          "WebFetch",
          "mcp__microclaw__*",
        ],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        settingSources: ["project"],
        mcpServers: {
          microclaw: ipcMcp,
        },
      },
    })) {
      if (message.type === "system" && message.subtype === "init") {
        newSessionId = message.session_id;
        log(`Session initialized: ${newSessionId}`);
      }

      if ("result" in message && message.result) {
        result = message.result as string;
      }
    }

    log("Agent completed successfully");
    writeOutput({
      status: "success",
      result,
      newSessionId,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: "error",
      result: null,
      newSessionId,
      error: errorMessage,
    });
    process.exit(1);
  }
}

main();
