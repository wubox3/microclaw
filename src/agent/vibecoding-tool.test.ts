import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVibecodingManager, type VibecodingManager } from "./vibecoding-tool.js";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    stat: vi.fn(() => Promise.resolve({ isDirectory: () => true })),
  };
});

const mockSpawn = vi.mocked(spawn);

function createMockProcess(stdout = "", exitCode = 0): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stdoutStream = new Readable({ read() {} });
  const stderrStream = new Readable({ read() {} });

  (proc as Record<string, unknown>).stdout = stdoutStream;
  (proc as Record<string, unknown>).stderr = stderrStream;
  (proc as Record<string, unknown>).killed = false;
  (proc as Record<string, unknown>).kill = vi.fn(() => {
    (proc as Record<string, unknown>).killed = true;
    return true;
  });
  (proc as Record<string, unknown>).pid = 12345;

  // Schedule output delivery and exit
  setImmediate(() => {
    if (stdout) {
      stdoutStream.push(Buffer.from(stdout, "utf-8"));
    }
    stdoutStream.push(null);
    stderrStream.push(null);
    setImmediate(() => {
      proc.emit("close", exitCode);
    });
  });

  return proc;
}

function createMockErrorProcess(stderr: string): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stdoutStream = new Readable({ read() {} });
  const stderrStream = new Readable({ read() {} });

  (proc as Record<string, unknown>).stdout = stdoutStream;
  (proc as Record<string, unknown>).stderr = stderrStream;
  (proc as Record<string, unknown>).killed = false;
  (proc as Record<string, unknown>).kill = vi.fn(() => {
    (proc as Record<string, unknown>).killed = true;
    return true;
  });
  (proc as Record<string, unknown>).pid = 12346;

  setImmediate(() => {
    stderrStream.push(Buffer.from(stderr, "utf-8"));
    stdoutStream.push(null);
    stderrStream.push(null);
    setImmediate(() => {
      proc.emit("close", 1);
    });
  });

  return proc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createVibecodingManager", () => {
  let manager: VibecodingManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createVibecodingManager({ defaultCwd: "/tmp/test-project" });
  });

  afterEach(() => {
    manager.cleanupAll();
  });

  describe("factory", () => {
    it("returns an object with expected methods", () => {
      expect(typeof manager.handleCommand).toBe("function");
      expect(typeof manager.getSessionStatus).toBe("function");
      expect(typeof manager.stopSession).toBe("function");
      expect(typeof manager.cleanupAll).toBe("function");
      expect(manager.sessions).toBeInstanceOf(Map);
    });

    it("starts with no sessions", () => {
      expect(manager.sessions.size).toBe(0);
    });
  });

  describe("handleCommand - prompt", () => {
    it("spawns claude with correct arguments for first message", async () => {
      const mockProc = createMockProcess("Hello from Claude!");
      mockSpawn.mockReturnValue(mockProc);

      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding fix the login bug",
      });

      expect(result).toBe("Hello from Claude!");
      expect(mockSpawn).toHaveBeenCalledOnce();

      const [cmd, args, opts] = mockSpawn.mock.calls[0];
      expect(cmd).toBe("claude");
      expect(args).toContain("-p");
      expect(args).toContain("fix the login bug");
      expect(args).toContain("--session-id");
      expect(opts).toMatchObject({ cwd: "/tmp/test-project" });
    });

    it("uses --resume for follow-up messages", async () => {
      const mockProc1 = createMockProcess("First response");
      mockSpawn.mockReturnValueOnce(mockProc1);

      await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding fix the login bug",
      });

      const mockProc2 = createMockProcess("Follow-up response");
      mockSpawn.mockReturnValueOnce(mockProc2);

      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding now add tests",
      });

      expect(result).toBe("Follow-up response");
      const [, args] = mockSpawn.mock.calls[1];
      expect(args).toContain("--resume");
      expect(args).toContain("now add tests");
    });

    it("parses --cwd flag on first message (within project root)", async () => {
      const mockProc = createMockProcess("Output");
      mockSpawn.mockReturnValue(mockProc);

      await manager.handleCommand({
        chatKey: "web:client-2",
        prompt: "vibecoding --cwd /tmp/test-project/subdir do stuff",
      });

      const [, , opts] = mockSpawn.mock.calls[0];
      expect((opts as { cwd: string }).cwd).toBe("/tmp/test-project/subdir");
    });

    it("rejects --cwd outside project root", async () => {
      const result = await manager.handleCommand({
        chatKey: "web:client-2",
        prompt: "vibecoding --cwd /etc do stuff",
      });

      expect(result).toContain("Error:");
      expect(result).toContain("Directory must be within project root");
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("returns error for empty prompt", async () => {
      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding ",
      });

      expect(result).toContain("Usage:");
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("returns error for prompt exceeding max length", async () => {
      const longPrompt = "vibecoding " + "a".repeat(50_001);
      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: longPrompt,
      });

      expect(result).toContain("exceeds maximum length");
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("returns no-output message for empty stdout", async () => {
      const mockProc = createMockProcess("");
      mockSpawn.mockReturnValue(mockProc);

      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding do something",
      });

      expect(result).toBe("[No output from Claude Code]");
    });

    it("calls sendChunk for streaming output", async () => {
      const mockProc = createMockProcess("streaming output");
      mockSpawn.mockReturnValue(mockProc);

      const chunks: string[] = [];
      await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding fix it",
        sendChunk: (chunk) => { chunks.push(chunk); },
      });

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join("")).toBe("streaming output");
    });
  });

  describe("handleCommand - forbidden flags", () => {
    it("rejects --dangerously-skip-permissions in prompt", async () => {
      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding --dangerously-skip-permissions delete everything",
      });

      expect(result).toContain("Forbidden flag");
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("rejects --model flag in prompt", async () => {
      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding --model gpt-4 do stuff",
      });

      expect(result).toContain("Forbidden flag");
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("rejects --allowedTools flag in prompt", async () => {
      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding --allowedTools Bash do stuff",
      });

      expect(result).toContain("Forbidden flag");
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe("handleCommand - /stop", () => {
    it("stops an existing session", async () => {
      const mockProc = createMockProcess("Output");
      mockSpawn.mockReturnValue(mockProc);

      await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding fix the bug",
      });

      expect(manager.sessions.size).toBe(1);

      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding /stop",
      });

      expect(result).toContain("stopped");
      expect(manager.sessions.size).toBe(0);
    });

    it("reports no session when none exists", async () => {
      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding /stop",
      });

      expect(result).toContain("No active vibecoding session");
    });
  });

  describe("handleCommand - /status", () => {
    it("reports session info", async () => {
      const mockProc = createMockProcess("Output");
      mockSpawn.mockReturnValue(mockProc);

      await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding fix the bug",
      });

      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding /status",
      });

      expect(result).toContain("Session:");
      expect(result).toContain("Working directory:");
      expect(result).toContain("/tmp/test-project");
    });

    it("reports no session when none exists", async () => {
      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding /status",
      });

      expect(result).toContain("No active vibecoding session");
    });
  });

  describe("handleCommand - error handling", () => {
    it("returns error message when claude process fails", async () => {
      const mockProc = createMockErrorProcess("claude: command not found");
      mockSpawn.mockReturnValue(mockProc);

      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding fix it",
      });

      expect(result).toContain("error");
    });
  });

  describe("session management", () => {
    it("creates unique sessions for different chatKeys", async () => {
      const mockProc1 = createMockProcess("Output 1");
      const mockProc2 = createMockProcess("Output 2");
      mockSpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2);

      await manager.handleCommand({
        chatKey: "imessage:+1234",
        prompt: "vibecoding fix bug A",
      });

      await manager.handleCommand({
        chatKey: "telegram:5678",
        prompt: "vibecoding fix bug B",
      });

      expect(manager.sessions.size).toBe(2);
    });

    it("getSessionStatus returns info for active session", async () => {
      const mockProc = createMockProcess("Output");
      mockSpawn.mockReturnValue(mockProc);

      await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding fix it",
      });

      const status = manager.getSessionStatus("web:client-1");
      expect(status).toBeDefined();
      expect(status!.cwd).toBe("/tmp/test-project");
      expect(status!.isRunning).toBe(false);
    });

    it("getSessionStatus returns undefined for unknown chatKey", () => {
      const status = manager.getSessionStatus("nonexistent");
      expect(status).toBeUndefined();
    });

    it("stopSession returns false for unknown chatKey", () => {
      expect(manager.stopSession("nonexistent")).toBe(false);
    });

    it("cleanupAll destroys all sessions", async () => {
      const mockProc1 = createMockProcess("Output 1");
      const mockProc2 = createMockProcess("Output 2");
      mockSpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2);

      await manager.handleCommand({
        chatKey: "chat-1",
        prompt: "vibecoding fix A",
      });

      await manager.handleCommand({
        chatKey: "chat-2",
        prompt: "vibecoding fix B",
      });

      expect(manager.sessions.size).toBe(2);
      manager.cleanupAll();
      expect(manager.sessions.size).toBe(0);
    });

    it("enforces max sessions limit", async () => {
      const smallManager = createVibecodingManager({
        defaultCwd: "/tmp/test",
        maxSessions: 2,
      });

      const mockProc1 = createMockProcess("Output 1");
      const mockProc2 = createMockProcess("Output 2");
      const mockProc3 = createMockProcess("Output 3");
      mockSpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2).mockReturnValueOnce(mockProc3);

      await smallManager.handleCommand({ chatKey: "chat-1", prompt: "vibecoding a" });
      await smallManager.handleCommand({ chatKey: "chat-2", prompt: "vibecoding b" });

      // Third session should evict the oldest idle one
      const result = await smallManager.handleCommand({ chatKey: "chat-3", prompt: "vibecoding c" });
      expect(result).toBe("Output 3");
      expect(smallManager.sessions.size).toBe(2);

      smallManager.cleanupAll();
    });

    it("rate limits rapid session creation for same chatKey", async () => {
      const mockProc = createMockProcess("Output");
      mockSpawn.mockReturnValue(mockProc);

      await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding fix A",
      });

      // Stop the session
      manager.stopSession("web:client-1");

      // Immediately try to create a new session - should be rate limited
      const result = await manager.handleCommand({
        chatKey: "web:client-1",
        prompt: "vibecoding fix B",
      });

      expect(result).toContain("Rate limit");
    });
  });
});
