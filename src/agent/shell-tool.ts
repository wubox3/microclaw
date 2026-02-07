import { exec } from "node:child_process";
import { createLogger } from "../logging.js";
import type { AgentTool, AgentToolResult } from "./types.js";

const log = createLogger("shell-tool");

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 50_000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }
  return output.slice(0, MAX_OUTPUT_CHARS) + `\n...[truncated, ${output.length - MAX_OUTPUT_CHARS} chars omitted]`;
}

export function createShellTool(opts: { cwd: string }): AgentTool {
  const { cwd } = opts;

  return {
    name: "shell",
    description:
      "Run a shell command in the user's workspace. Supports pipes, redirects, and standard shell syntax. " +
      "Use for file listing, git operations, searching, building, testing, and other command-line tasks. " +
      "Commands time out after 30 seconds.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute (e.g. 'ls -la', 'git status', 'grep -r pattern .')",
        },
      },
      required: ["command"],
    },
    execute: async (params): Promise<AgentToolResult> => {
      const command = typeof params.command === "string" ? params.command.trim() : "";

      if (command === "") {
        return { content: "Error: command is required and must be a non-empty string.", isError: true };
      }

      return new Promise((resolve) => {
        exec(command, { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
          const combined = [stdout, stderr].filter(Boolean).join("\n").trim();

          if (error) {
            const message = error.killed
              ? `Command timed out after ${TIMEOUT_MS / 1000}s`
              : error.signal
                ? `Command killed by signal ${error.signal}`
                : combined || error.message;

            log.warn(`Shell command failed: ${command.slice(0, 200)}`);
            resolve({ content: truncateOutput(message), isError: true });
            return;
          }

          log.debug(`Shell command succeeded: ${command.slice(0, 200)}`);
          resolve({ content: truncateOutput(combined || "(no output)") });
        });
      });
    },
  };
}
