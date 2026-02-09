import { execFile } from "node:child_process";
import type { AgentTool, AgentToolResult } from "../../../src/skill-sdk/index.js";

const MAX_OUTPUT_CHARS = 8000;
const EXEC_TIMEOUT_MS = 30_000;

const SHELL_META = /[;|&`$><\n\\]/;

const ALLOWED_COMMANDS = new Set([
  "whoami",
  "check",
  "query-ids",
  "read",
  "thread",
  "replies",
  "home",
  "user-tweets",
  "mentions",
  "search",
  "news",
  "trending",
  "lists",
  "list-timeline",
  "bookmarks",
  "unbookmark",
  "likes",
  "following",
  "followers",
  "about",
  "follow",
  "unfollow",
  "tweet",
  "reply",
]);

type ParseResult =
  | { ok: true; args: ReadonlyArray<string> }
  | { ok: false; error: string };

export function parseCommand(raw: string): ParseResult {
  const args: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (ch === "\\" && i + 1 < raw.length && (inDouble || inSingle)) {
      current += raw[i + 1];
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === " " && !inSingle && !inDouble) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (inSingle || inDouble) {
    return { ok: false, error: "Unterminated quote in command" };
  }

  if (current.length > 0) {
    args.push(current);
  }

  return { ok: true, args };
}

export function validateArgs(args: ReadonlyArray<string>): string | null {
  if (args.length === 0) {
    return "No command provided. Example: bird whoami";
  }

  const subcommand = args[0];
  if (!ALLOWED_COMMANDS.has(subcommand)) {
    return `Unknown bird command: "${subcommand}". Allowed: ${[...ALLOWED_COMMANDS].join(", ")}`;
  }

  for (const arg of args) {
    if (SHELL_META.test(arg)) {
      return "Shell metacharacters are not allowed in arguments";
    }
  }

  return null;
}

export function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) {
    return text;
  }
  return text.slice(0, MAX_OUTPUT_CHARS) + `\n... (truncated, ${text.length} chars total)`;
}

function buildFinalArgs(args: ReadonlyArray<string>): ReadonlyArray<string> {
  const hasJson = args.some((a) => a === "--json" || a === "--json-full");
  return hasJson ? [...args] : [...args, "--plain"];
}

export function runBird(args: ReadonlyArray<string>): Promise<AgentToolResult> {
  return new Promise((resolve) => {
    execFile(
      "bird",
      [...buildFinalArgs(args)],
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            resolve({
              content: "bird CLI not found. Install with: npm install -g @steipete/bird  OR  brew install steipete/tap/bird",
              isError: true,
            });
            return;
          }
          const msg = stderr.trim() || error.message;
          resolve({
            content: truncateOutput(`bird ${args.join(" ")} failed:\n${msg}`),
            isError: true,
          });
          return;
        }

        const output = (stdout || stderr).trim();
        if (output.length === 0) {
          resolve({ content: "Command completed with no output." });
          return;
        }
        resolve({ content: truncateOutput(output) });
      },
    );
  });
}

export function createBirdTool(): AgentTool {
  return {
    name: "bird",
    description: `X/Twitter CLI tool. Read tweets, search, view timelines, post, and engage.

Commands: whoami, check, read <url>, thread <url>, replies <url>, home, user-tweets @handle, mentions, search "query", news, trending, lists, list-timeline <id>, bookmarks, unbookmark <url>, likes, following, followers, about @handle, follow @handle, unfollow @handle, tweet "text", reply <url> "text"
Options: --json, --all, --max-pages N, -n N (count), --following`,

    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: 'The bird subcommand and arguments. Example: "search AI news -n 5"',
        },
      },
      required: ["command"],
    },

    execute: async (params: Record<string, unknown>): Promise<AgentToolResult> => {
      const command = params.command;
      if (typeof command !== "string" || command.trim().length === 0) {
        return { content: "command parameter is required (string)", isError: true };
      }

      const parsed = parseCommand(command.trim());
      if (!parsed.ok) {
        return { content: parsed.error, isError: true };
      }

      const validationError = validateArgs(parsed.args);
      if (validationError !== null) {
        return { content: validationError, isError: true };
      }

      return runBird(parsed.args);
    },
  };
}
