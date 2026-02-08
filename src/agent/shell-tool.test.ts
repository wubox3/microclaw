import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createShellTool } from "./shell-tool.js";
import type { AgentTool } from "./types.js";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(cwd?: string): AgentTool {
  return createShellTool({ cwd: cwd ?? process.cwd() });
}

// ---------------------------------------------------------------------------
// Tool shape / integration
// ---------------------------------------------------------------------------

describe("createShellTool — structure", () => {
  it("returns an object with the correct name", () => {
    const tool = makeTool();
    expect(tool.name).toBe("shell");
  });

  it("has a non-empty description mentioning shell or command", () => {
    const tool = makeTool();
    expect(tool.description).toBeTruthy();
    expect(tool.description.toLowerCase()).toMatch(/shell|command/);
  });

  it("has input_schema with command as a required string property", () => {
    const tool = makeTool();
    const schema = tool.input_schema;

    expect(schema.type).toBe("object");
    expect(schema.required).toContain("command");

    const properties = schema.properties as Record<string, { type: string }>;
    expect(properties.command.type).toBe("string");
  });

  it("has an async execute function", () => {
    const tool = makeTool();
    expect(typeof tool.execute).toBe("function");
  });

  it("satisfies the AgentTool type contract", () => {
    const tool: AgentTool = makeTool();
    expect(tool.name).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(tool.input_schema).toBeDefined();
    expect(tool.execute).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// execute — successful commands
// ---------------------------------------------------------------------------

describe("execute — successful commands", () => {
  it("executes echo and returns stdout", async () => {
    const tool = makeTool();
    const result = await tool.execute({ command: "echo hello" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("hello");
  });

  it("returns combined stdout and stderr", async () => {
    const tool = makeTool();
    // Write to both stdout and stderr
    const result = await tool.execute({
      command: 'echo out && echo err >&2',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("out");
    expect(result.content).toContain("err");
  });

  it("returns '(no output)' when command produces no output", async () => {
    const tool = makeTool();
    const result = await tool.execute({ command: "true" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("(no output)");
  });

  it("supports pipes and shell syntax", async () => {
    const tool = makeTool();
    const result = await tool.execute({
      command: 'echo "line1\nline2\nline3" | wc -l',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content.trim()).toBe("3");
  });
});

// ---------------------------------------------------------------------------
// execute — working directory
// ---------------------------------------------------------------------------

describe("execute — working directory", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shell-tool-test-"));
    writeFileSync(join(tempDir, "marker.txt"), "found-it");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("runs commands in the configured cwd", async () => {
    const tool = createShellTool({ cwd: tempDir });
    const result = await tool.execute({ command: "cat marker.txt" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("found-it");
  });

  it("pwd reflects the configured cwd", async () => {
    const tool = createShellTool({ cwd: tempDir });
    const result = await tool.execute({ command: "pwd" });

    expect(result.isError).toBeUndefined();
    // Resolve symlinks (macOS /var -> /private/var)
    expect(result.content).toContain(tempDir.replace(/^\/private/, "").replace(/^\/var/, ""));
  });
});

// ---------------------------------------------------------------------------
// execute — error handling
// ---------------------------------------------------------------------------

describe("execute — error handling", () => {
  it("returns isError true for empty command string", async () => {
    const tool = makeTool();
    const result = await tool.execute({ command: "" });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/command.*required/i);
  });

  it("returns isError true for whitespace-only command", async () => {
    const tool = makeTool();
    const result = await tool.execute({ command: "   " });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/command.*required/i);
  });

  it("returns isError true when command param is missing", async () => {
    const tool = makeTool();
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/command.*required/i);
  });

  it("returns isError true when command param is not a string", async () => {
    const tool = makeTool();
    const result = await tool.execute({ command: 42 });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/command.*required/i);
  });

  it("returns isError true for non-existent command", async () => {
    const tool = makeTool();
    const result = await tool.execute({
      command: "definitely_not_a_real_command_xyzzy_12345",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toBeTruthy();
  });

  it("returns isError true for command with non-zero exit code", async () => {
    const tool = makeTool();
    const result = await tool.execute({ command: "exit 1" });

    expect(result.isError).toBe(true);
  });

  it("returns stderr content in error message for failing command", async () => {
    const tool = makeTool();
    const result = await tool.execute({
      command: 'echo "failure details" >&2 && exit 1',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("failure details");
  });
});

// ---------------------------------------------------------------------------
// execute — timeout
// ---------------------------------------------------------------------------

describe("execute — timeout", () => {
  it("kills command that exceeds 30s timeout", async () => {
    const tool = makeTool();
    const result = await tool.execute({ command: "sleep 60" });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/timed?\s*out/i);
  }, 35_000);
});

// ---------------------------------------------------------------------------
// execute — output truncation
// ---------------------------------------------------------------------------

describe("execute — output truncation", () => {
  it("truncates output exceeding 50k characters", async () => {
    const tool = makeTool();
    // Generate ~60k characters of output using head
    const result = await tool.execute({
      command: "yes a | head -c 60000",
    });

    expect(result.isError).toBeUndefined();
    // The content should be truncated with the truncation marker
    expect(result.content.length).toBeLessThanOrEqual(50_100); // 50k + truncation message
    expect(result.content).toContain("truncated");
    expect(result.content).toContain("chars omitted");
  });

  it("does not truncate output under 50k characters", async () => {
    const tool = makeTool();
    const result = await tool.execute({
      command: 'echo "short output"',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("short output");
    expect(result.content).not.toContain("truncated");
  });
});
