import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createShellTool, cleanupAllSessions, getSessionCount } from "./shell-tool.js";
import type { AgentTool } from "./types.js";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(cwd?: string): AgentTool {
  return createShellTool({ cwd: cwd ?? process.cwd(), shellPath: process.env.PATH ?? "/usr/bin:/bin" });
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

  it("has action, session_id, and display in input_schema properties", () => {
    const tool = makeTool();
    const properties = tool.input_schema.properties as Record<string, unknown>;
    expect(properties.action).toBeDefined();
    expect(properties.session_id).toBeDefined();
    expect(properties.display).toBeDefined();
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
// execute — successful commands (one-off / default action)
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

  it("defaults to action=run when action is not specified", async () => {
    const tool = makeTool();
    const result = await tool.execute({ command: "echo default-action" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("default-action");
  });

  it("works with explicit action=run", async () => {
    const tool = makeTool();
    const result = await tool.execute({ action: "run", command: "echo explicit-run" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("explicit-run");
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

// ---------------------------------------------------------------------------
// display option
// ---------------------------------------------------------------------------

describe("execute — display option", () => {
  it("returns full output when display is true (default)", async () => {
    const tool = makeTool();
    const result = await tool.execute({ command: "echo hello-display" });

    expect(result.content).toBe("hello-display");
  });

  it("returns summary when display is false for successful command", async () => {
    const tool = makeTool();
    const result = await tool.execute({ command: "echo hello-nodisplay", display: false });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("exit code 0");
    expect(result.content).toContain("chars output");
    expect(result.content).not.toContain("hello-nodisplay");
  });

  it("returns summary with error preview when display is false for failed command", async () => {
    const tool = makeTool();
    const result = await tool.execute({
      command: 'echo "error-detail" >&2 && exit 2',
      display: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Command failed");
    expect(result.content).toContain("error-detail");
  });
});

// ---------------------------------------------------------------------------
// buffer_limit option
// ---------------------------------------------------------------------------

describe("execute — buffer_limit option", () => {
  it("has buffer_limit in input_schema properties", () => {
    const tool = makeTool();
    const properties = tool.input_schema.properties as Record<string, unknown>;
    expect(properties.buffer_limit).toBeDefined();
  });

  it("errors when one-off command output exceeds custom buffer_limit", async () => {
    const tool = makeTool();
    // Set a tiny 100-byte buffer limit — 1KB of output should exceed it
    const result = await tool.execute({
      command: "yes a | head -c 1024",
      buffer_limit: 100,
    });

    expect(result.isError).toBe(true);
  });

  it("allows output within the custom buffer_limit", async () => {
    const tool = makeTool();
    const result = await tool.execute({
      command: "echo small",
      buffer_limit: 1024 * 1024, // 1MB — plenty for "small"
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("small");
  });

  it("clamps buffer_limit to 4GB maximum", async () => {
    const tool = makeTool();
    // Passing absurdly large value should not crash — gets clamped
    const result = await tool.execute({
      command: "echo clamped",
      buffer_limit: 10 * 1024 * 1024 * 1024, // 10GB — should be clamped to 4GB
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("clamped");
  });

  it("uses default 100MB when buffer_limit is not specified", async () => {
    const tool = makeTool();
    const result = await tool.execute({ command: "echo default-buffer" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("default-buffer");
  });

  afterEach(() => {
    cleanupAllSessions();
  });

  it("errors when session command output exceeds custom buffer_limit", async () => {
    const tool = makeTool();

    const startResult = await tool.execute({ action: "start_session", command: "" });
    const { session_id } = JSON.parse(startResult.content);

    const result = await tool.execute({
      action: "run_in_session",
      session_id,
      command: "yes a | head -c 1024",
      buffer_limit: 100, // tiny limit
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("buffer limit");
  });
});

// ---------------------------------------------------------------------------
// Persistent sessions — start, run, end
// ---------------------------------------------------------------------------

describe("persistent sessions", () => {
  afterEach(() => {
    cleanupAllSessions();
  });

  it("start_session creates a session and returns a session_id", async () => {
    const tool = makeTool();
    const result = await tool.execute({ action: "start_session", command: "" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content);
    expect(parsed.session_id).toBeTruthy();
    expect(typeof parsed.session_id).toBe("string");
    expect(parsed.message).toContain("session started");
  });

  it("run_in_session executes a command and returns output", async () => {
    const tool = makeTool();

    const startResult = await tool.execute({ action: "start_session", command: "" });
    const { session_id } = JSON.parse(startResult.content);

    const result = await tool.execute({
      action: "run_in_session",
      session_id,
      command: "echo session-output",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("session-output");
  });

  it("sessions preserve state across commands (cd + pwd)", async () => {
    const tool = makeTool();

    const startResult = await tool.execute({ action: "start_session", command: "" });
    const { session_id } = JSON.parse(startResult.content);

    // Change directory
    await tool.execute({
      action: "run_in_session",
      session_id,
      command: "cd /tmp",
    });

    // Verify cwd was preserved
    const pwdResult = await tool.execute({
      action: "run_in_session",
      session_id,
      command: "pwd",
    });

    expect(pwdResult.isError).toBeUndefined();
    // macOS may resolve /tmp -> /private/tmp
    expect(pwdResult.content).toMatch(/\/tmp$/);
  });

  it("sessions preserve state across multiple directory changes", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "shell-session-state-"));

    try {
      const tool = createShellTool({ cwd: tempDir });

      const startResult = await tool.execute({ action: "start_session", command: "" });
      const { session_id } = JSON.parse(startResult.content);

      // Create a subdirectory and cd into it
      await tool.execute({
        action: "run_in_session",
        session_id,
        command: "mkdir -p subdir/nested",
      });

      await tool.execute({
        action: "run_in_session",
        session_id,
        command: "cd subdir/nested",
      });

      // Verify cwd was preserved through multiple cd's
      const pwdResult = await tool.execute({
        action: "run_in_session",
        session_id,
        command: "pwd",
      });

      expect(pwdResult.isError).toBeUndefined();
      expect(pwdResult.content).toContain("subdir/nested");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("end_session kills the session", async () => {
    const tool = makeTool();

    const startResult = await tool.execute({ action: "start_session", command: "" });
    const { session_id } = JSON.parse(startResult.content);

    const endResult = await tool.execute({
      action: "end_session",
      session_id,
      command: "",
    });

    expect(endResult.isError).toBeUndefined();
    expect(endResult.content).toContain("ended");

    // Running in the ended session should fail
    const afterEnd = await tool.execute({
      action: "run_in_session",
      session_id,
      command: "echo should-fail",
    });

    expect(afterEnd.isError).toBe(true);
    expect(afterEnd.content).toContain("not found");
  });

  it("run_in_session returns error for non-existent session_id", async () => {
    const tool = makeTool();
    const result = await tool.execute({
      action: "run_in_session",
      session_id: "nonexistent",
      command: "echo hello",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("not found");
  });

  it("end_session returns error for non-existent session_id", async () => {
    const tool = makeTool();
    const result = await tool.execute({
      action: "end_session",
      session_id: "nonexistent",
      command: "",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("not found");
  });

  it("run_in_session requires session_id", async () => {
    const tool = makeTool();
    const result = await tool.execute({
      action: "run_in_session",
      command: "echo hello",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("session_id is required");
  });

  it("end_session requires session_id", async () => {
    const tool = makeTool();
    const result = await tool.execute({
      action: "end_session",
      command: "",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("session_id is required");
  });

  it("run_in_session requires command", async () => {
    const tool = makeTool();

    const startResult = await tool.execute({ action: "start_session", command: "" });
    const { session_id } = JSON.parse(startResult.content);

    const result = await tool.execute({
      action: "run_in_session",
      session_id,
      command: "",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/command.*required/i);
  });

  it("blocked commands are rejected in sessions too", async () => {
    const tool = makeTool();

    const startResult = await tool.execute({ action: "start_session", command: "" });
    const { session_id } = JSON.parse(startResult.content);

    const result = await tool.execute({
      action: "run_in_session",
      session_id,
      command: "sudo rm -rf /",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("blocked for safety");
  });

  it("display: false works in sessions", async () => {
    const tool = makeTool();

    const startResult = await tool.execute({ action: "start_session", command: "" });
    const { session_id } = JSON.parse(startResult.content);

    const result = await tool.execute({
      action: "run_in_session",
      session_id,
      command: "echo hidden-output",
      display: false,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("exit code 0");
    expect(result.content).not.toContain("hidden-output");
  });

  it("reports non-zero exit code in session commands", async () => {
    const tool = makeTool();

    const startResult = await tool.execute({ action: "start_session", command: "" });
    const { session_id } = JSON.parse(startResult.content);

    const result = await tool.execute({
      action: "run_in_session",
      session_id,
      command: "exit 42",
    });

    // The session's shell exits, so it should report an error
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session limits
// ---------------------------------------------------------------------------

describe("session limits", () => {
  afterEach(() => {
    cleanupAllSessions();
  });

  it("enforces maximum session limit", async () => {
    const tool = makeTool();

    // Start MAX_SESSIONS (10) sessions
    for (let i = 0; i < 10; i++) {
      const result = await tool.execute({ action: "start_session", command: "" });
      expect(result.isError).toBeUndefined();
    }

    expect(getSessionCount()).toBe(10);

    // The 11th should fail
    const result = await tool.execute({ action: "start_session", command: "" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("maximum");
  });

  it("cleanupAllSessions removes all sessions", async () => {
    const tool = makeTool();

    await tool.execute({ action: "start_session", command: "" });
    await tool.execute({ action: "start_session", command: "" });

    expect(getSessionCount()).toBe(2);

    cleanupAllSessions();

    expect(getSessionCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Idle timeout
// ---------------------------------------------------------------------------

describe("session idle timeout", () => {
  afterEach(() => {
    cleanupAllSessions();
    vi.useRealTimers();
  });

  it("auto-cleans session after idle timeout", async () => {
    vi.useFakeTimers();

    const tool = makeTool();
    const startResult = await tool.execute({ action: "start_session", command: "" });
    const { session_id } = JSON.parse(startResult.content);

    expect(getSessionCount()).toBe(1);

    // Fast-forward past the idle timeout (10 minutes)
    vi.advanceTimersByTime(10 * 60 * 1000 + 1000);

    expect(getSessionCount()).toBe(0);

    // Trying to use it should fail
    const result = await tool.execute({
      action: "run_in_session",
      session_id,
      command: "echo hello",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("not found");
  });
});
