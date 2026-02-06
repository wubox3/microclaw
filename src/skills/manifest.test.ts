import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateManifest, readSkillManifest } from "./manifest.js";
import type { SkillManifest } from "./manifest.js";

// ---------------------------------------------------------------------------
// Mock node:fs
// ---------------------------------------------------------------------------

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
}));

const { existsSync, readFileSync } = await import("node:fs");
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
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
  it("returns parsed manifest when file exists", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"id":"my-skill","name":"My Skill"}');
    const result = readSkillManifest("/skills/my-skill");
    expect(result).toEqual({ id: "my-skill", name: "My Skill" });
  });

  it("returns null when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(readSkillManifest("/skills/missing")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{invalid json}");
    expect(readSkillManifest("/skills/bad")).toBeNull();
  });
});
