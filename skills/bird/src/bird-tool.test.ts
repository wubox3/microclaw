import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBirdTool, parseCommand, validateArgs, truncateOutput, runBird } from "./bird-tool.js";
import type { AgentTool } from "../../../src/skill-sdk/index.js";
import * as cp from "node:child_process";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(cp.execFile);

const dummyCtx = { sessionKey: "", channelId: "web", chatId: "", config: {} as never };

function mockExecFileSuccess(stdout: string, stderr = "") {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, cb: unknown) => {
    (cb as (err: null, stdout: string, stderr: string) => void)(null, stdout, stderr);
    return undefined as never;
  });
}

function mockExecFileError(error: Error & { code?: string }, stderr = "") {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, cb: unknown) => {
    (cb as (err: Error, stdout: string, stderr: string) => void)(error, "", stderr);
    return undefined as never;
  });
}

describe("parseCommand", () => {
  it("splits simple space-separated args", () => {
    const result = parseCommand("search AI news -n 5");
    expect(result).toEqual({ ok: true, args: ["search", "AI", "news", "-n", "5"] });
  });

  it("handles double-quoted strings", () => {
    const result = parseCommand('search "AI news" -n 5');
    expect(result).toEqual({ ok: true, args: ["search", "AI news", "-n", "5"] });
  });

  it("handles single-quoted strings", () => {
    const result = parseCommand("tweet 'hello world'");
    expect(result).toEqual({ ok: true, args: ["tweet", "hello world"] });
  });

  it("handles escaped quotes inside double quotes", () => {
    const result = parseCommand('tweet "hello \\"world\\""');
    expect(result).toEqual({ ok: true, args: ["tweet", 'hello "world"'] });
  });

  it("rejects unterminated double quote", () => {
    const result = parseCommand('tweet "hello world');
    expect(result).toEqual({ ok: false, error: "Unterminated quote in command" });
  });

  it("rejects unterminated single quote", () => {
    const result = parseCommand("tweet 'hello world");
    expect(result).toEqual({ ok: false, error: "Unterminated quote in command" });
  });

  it("handles empty input", () => {
    const result = parseCommand("");
    expect(result).toEqual({ ok: true, args: [] });
  });

  it("handles multiple spaces between args", () => {
    const result = parseCommand("whoami   --json");
    expect(result).toEqual({ ok: true, args: ["whoami", "--json"] });
  });
});

describe("validateArgs", () => {
  it("rejects empty args", () => {
    expect(validateArgs([])).toBe("No command provided. Example: bird whoami");
  });

  it("rejects unknown subcommand", () => {
    const err = validateArgs(["badcommand"]);
    expect(err).toContain("Unknown bird command");
  });

  it("accepts all allowed commands", () => {
    for (const cmd of ["whoami", "search", "tweet", "read", "thread", "home", "bookmarks", "unbookmark"]) {
      expect(validateArgs([cmd])).toBeNull();
    }
  });

  it("rejects semicolon", () => {
    expect(validateArgs(["search", "test;rm"])).toContain("metacharacters");
  });

  it("rejects pipe", () => {
    expect(validateArgs(["whoami", "|", "cat"])).toContain("metacharacters");
  });

  it("rejects ampersand", () => {
    expect(validateArgs(["search", "test&"])).toContain("metacharacters");
  });

  it("rejects backtick", () => {
    expect(validateArgs(["search", "`id`"])).toContain("metacharacters");
  });

  it("rejects dollar sign", () => {
    expect(validateArgs(["search", "$HOME"])).toContain("metacharacters");
  });

  it("rejects redirect", () => {
    expect(validateArgs(["search", ">file"])).toContain("metacharacters");
  });

  it("rejects newline", () => {
    expect(validateArgs(["search", "test\nrm"])).toContain("metacharacters");
  });
});

describe("truncateOutput", () => {
  it("returns short text unchanged", () => {
    expect(truncateOutput("hello")).toBe("hello");
  });

  it("truncates text exceeding limit", () => {
    const long = "x".repeat(9000);
    const result = truncateOutput(long);
    expect(result).toContain("truncated");
    expect(result).toContain("9000 chars total");
    expect(result.length).toBeLessThan(long.length);
  });

  it("returns text at exactly the limit unchanged", () => {
    const exact = "x".repeat(8000);
    expect(truncateOutput(exact)).toBe(exact);
  });
});

describe("runBird", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ENOENT install message when bird is not found", async () => {
    const err = Object.assign(new Error("spawn bird ENOENT"), { code: "ENOENT" });
    mockExecFileError(err);

    const result = await runBird(["whoami"]);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("bird CLI not found");
    expect(result.content).toContain("npm install -g @steipete/bird");
  });

  it("returns stderr on non-ENOENT error", async () => {
    const err = new Error("exit code 1");
    mockExecFileError(err, "Rate limited");

    const result = await runBird(["tweet", "hello"]);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Rate limited");
  });

  it("falls back to error.message when stderr is empty", async () => {
    const err = new Error("process timed out");
    mockExecFileError(err, "");

    const result = await runBird(["home"]);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("process timed out");
  });

  it("returns stdout on success", async () => {
    mockExecFileSuccess("@testuser (Test User)");

    const result = await runBird(["whoami"]);
    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("@testuser (Test User)");
  });

  it("returns empty output message when stdout and stderr are empty", async () => {
    mockExecFileSuccess("", "");

    const result = await runBird(["follow", "@user"]);
    expect(result.content).toBe("Command completed with no output.");
  });

  it("appends --plain when --json is not present", async () => {
    mockExecFileSuccess("output");

    await runBird(["whoami"]);
    expect(mockedExecFile).toHaveBeenCalledWith(
      "bird",
      ["whoami", "--plain"],
      expect.objectContaining({ timeout: 30_000 }),
      expect.any(Function),
    );
  });

  it("does not append --plain when --json is present", async () => {
    mockExecFileSuccess('{"user": "test"}');

    await runBird(["whoami", "--json"]);
    expect(mockedExecFile).toHaveBeenCalledWith(
      "bird",
      ["whoami", "--json"],
      expect.objectContaining({ timeout: 30_000 }),
      expect.any(Function),
    );
  });

  it("truncates long output", async () => {
    mockExecFileSuccess("x".repeat(9000));

    const result = await runBird(["home"]);
    expect(result.content).toContain("truncated");
  });
});

describe("createBirdTool", () => {
  let tool: AgentTool;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = createBirdTool();
  });

  it("returns a tool with correct metadata", () => {
    expect(tool.name).toBe("bird");
    expect(tool.description).toContain("X/Twitter CLI");
    expect(tool.parameters).toBeDefined();
  });

  it("rejects empty command", async () => {
    const result = await tool.execute({ command: "" }, dummyCtx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("required");
  });

  it("rejects missing command param", async () => {
    const result = await tool.execute({}, dummyCtx);
    expect(result.isError).toBe(true);
  });

  it("rejects non-string command", async () => {
    const result = await tool.execute({ command: 42 }, dummyCtx);
    expect(result.isError).toBe(true);
  });

  it("rejects unknown subcommand", async () => {
    const result = await tool.execute({ command: "badcommand" }, dummyCtx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unknown bird command");
  });

  it("rejects shell metacharacters", async () => {
    const result = await tool.execute({ command: 'search "test"; rm -rf /' }, dummyCtx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("metacharacters");
  });

  it("rejects unterminated quotes", async () => {
    const result = await tool.execute({ command: 'tweet "hello' }, dummyCtx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unterminated quote");
  });

  it("executes valid whoami command", async () => {
    mockExecFileSuccess("@myuser (My User)");
    const result = await tool.execute({ command: "whoami" }, dummyCtx);
    expect(result.content).toBe("@myuser (My User)");
  });

  it("executes valid search with quoted query", async () => {
    mockExecFileSuccess("Tweet 1\nTweet 2");
    const result = await tool.execute({ command: 'search "AI news" -n 5' }, dummyCtx);
    expect(result.content).toBe("Tweet 1\nTweet 2");
    expect(mockedExecFile).toHaveBeenCalledWith(
      "bird",
      ["search", "AI news", "-n", "5", "--plain"],
      expect.any(Object),
      expect.any(Function),
    );
  });
});
