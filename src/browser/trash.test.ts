import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";

vi.mock("./compat/exec.js", () => ({
  runExec: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false),
    renameSync: vi.fn(),
  },
}));

import { movePathToTrash } from "./trash.js";
import { runExec } from "./compat/exec.js";
import fs from "node:fs";

const mockedRunExec = vi.mocked(runExec);

beforeEach(() => {
  vi.clearAllMocks();
  (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// movePathToTrash
// ---------------------------------------------------------------------------

describe("movePathToTrash", () => {
  it("returns original path when trash command succeeds", async () => {
    mockedRunExec.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 } as never);
    const result = await movePathToTrash("/tmp/test-file");
    expect(result).toBe("/tmp/test-file");
    expect(mockedRunExec).toHaveBeenCalledWith("trash", ["/tmp/test-file"], { timeout: 10_000 });
  });

  it("falls back to .Trash rename when trash command fails", async () => {
    mockedRunExec.mockRejectedValueOnce(new Error("trash not found"));

    const result = await movePathToTrash("/tmp/test-file");

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join(os.homedir(), ".Trash"),
      { recursive: true },
    );
    expect(fs.renameSync).toHaveBeenCalled();
    expect(result).toMatch(/\.Trash/);
    expect(result).toMatch(/test-file-/);
  });

  it("appends random suffix when destination already exists", async () => {
    mockedRunExec.mockRejectedValueOnce(new Error("trash not found"));
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const result = await movePathToTrash("/tmp/test-file");

    // With collision, the path includes both Date.now() and Math.random()
    const renameCall = (fs.renameSync as ReturnType<typeof vi.fn>).mock.calls[0];
    const dest = renameCall?.[1] as string;
    // The dest should contain an extra random component (two dashes after the filename)
    const parts = path.basename(dest).split("-");
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  it("creates .Trash directory on fallback", async () => {
    mockedRunExec.mockRejectedValueOnce(new Error("trash not found"));

    await movePathToTrash("/tmp/some-dir");

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join(os.homedir(), ".Trash"),
      { recursive: true },
    );
  });

  it("handles nested file paths correctly", async () => {
    mockedRunExec.mockRejectedValueOnce(new Error("trash not found"));

    const result = await movePathToTrash("/deep/nested/path/my-file.txt");

    const renameCall = (fs.renameSync as ReturnType<typeof vi.fn>).mock.calls[0];
    const dest = renameCall?.[1] as string;
    expect(dest).toMatch(/my-file\.txt-/);
  });
});
