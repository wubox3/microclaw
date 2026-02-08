import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateManifest, readSkillManifest } from "./manifest.js";
import type { SkillManifest } from "./manifest.js";

// ---------------------------------------------------------------------------
// Mock node:fs/promises
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  access: vi.fn(() => Promise.reject(new Error("ENOENT"))),
  readFile: vi.fn(() => Promise.resolve("")),
}));

const { access, readFile } = await import("node:fs/promises");
const mockAccess = vi.mocked(access);
const mockReadFile = vi.mocked(readFile);

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockRejectedValue(new Error("ENOENT"));
});

// ---------------------------------------------------------------------------
// validateManifest
// ---------------------------------------------------------------------------

describe("validateManifest", () => {
  it("returns no errors for valid manifest", () => {
    const manifest: SkillManifest = { id: "my-skill", name: "My Skill" };
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("returns error when id is missing", () => {
    const manifest = { id: "", name: "My Skill" } as SkillManifest;
    const errors = validateManifest(manifest);
    expect(errors).toContain("Manifest missing required field: id");
  });

  it("returns error when name is missing", () => {
    const manifest = { id: "my-skill", name: "" } as SkillManifest;
    const errors = validateManifest(manifest);
    expect(errors).toContain("Manifest missing required field: name");
  });

  it("returns multiple errors when both missing", () => {
    const manifest = { id: "", name: "" } as SkillManifest;
    const errors = validateManifest(manifest);
    expect(errors).toHaveLength(2);
  });

  it("accepts manifest with optional fields", () => {
    const manifest: SkillManifest = {
      id: "test",
      name: "Test",
      description: "A test skill",
      version: "1.0.0",
      entry: "index.js",
    };
    expect(validateManifest(manifest)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readSkillManifest
// ---------------------------------------------------------------------------

describe("readSkillManifest", () => {
  it("returns parsed manifest when file exists", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('{"id":"my-skill","name":"My Skill"}');
    const result = await readSkillManifest("/skills/my-skill");
    expect(result).toEqual({ id: "my-skill", name: "My Skill" });
  });

  it("returns null when file does not exist", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    const result = await readSkillManifest("/skills/missing");
    expect(result).toBeNull();
  });

  it("returns null for invalid JSON", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue("{invalid json}");
    const result = await readSkillManifest("/skills/bad");
    expect(result).toBeNull();
  });
});
