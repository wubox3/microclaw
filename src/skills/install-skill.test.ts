import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseArgs,
  deriveNameFromUrl,
  isWithinDir,
  rollback,
  VALID_DIR_NAME,
  VALID_GIT_URL,
} from "./install-skill.js";
import { existsSync, rmSync } from "node:fs";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

const mockExistsSync = vi.mocked(existsSync);
const mockRmSync = vi.mocked(rmSync);

describe("install-skill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation((code?: number | string | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("VALID_GIT_URL", () => {
    it("accepts https URLs", () => {
      expect(VALID_GIT_URL.test("https://github.com/user/repo.git")).toBe(true);
      expect(VALID_GIT_URL.test("https://github.com/user/repo")).toBe(true);
    });

    it("accepts http URLs", () => {
      expect(VALID_GIT_URL.test("http://github.com/user/repo")).toBe(true);
    });

    it("accepts SSH URLs", () => {
      expect(VALID_GIT_URL.test("git@github.com:user/repo.git")).toBe(true);
    });

    it("accepts git:// URLs", () => {
      expect(VALID_GIT_URL.test("git://github.com/user/repo.git")).toBe(true);
    });

    it("rejects non-URL strings", () => {
      expect(VALID_GIT_URL.test("not-a-url")).toBe(false);
      expect(VALID_GIT_URL.test("")).toBe(false);
      expect(VALID_GIT_URL.test("ftp://example.com/repo")).toBe(false);
    });
  });

  describe("VALID_DIR_NAME", () => {
    it("accepts valid directory names", () => {
      expect(VALID_DIR_NAME.test("my-skill")).toBe(true);
      expect(VALID_DIR_NAME.test("skill_v2")).toBe(true);
      expect(VALID_DIR_NAME.test("skill.plugin")).toBe(true);
    });

    it("rejects path traversal", () => {
      expect(VALID_DIR_NAME.test("..")).toBe(false);
      expect(VALID_DIR_NAME.test("../etc")).toBe(false);
      expect(VALID_DIR_NAME.test("foo/bar")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(VALID_DIR_NAME.test("")).toBe(false);
    });
  });

  describe("parseArgs", () => {
    it("parses a URL from argv", () => {
      const result = parseArgs(["node", "script", "https://github.com/user/repo"]);
      expect(result).toEqual({ url: "https://github.com/user/repo", name: null });
    });

    it("parses URL with --name flag", () => {
      const result = parseArgs(["node", "script", "https://github.com/user/repo", "--name", "my-skill"]);
      expect(result).toEqual({ url: "https://github.com/user/repo", name: "my-skill" });
    });

    it("parses --name before URL", () => {
      const result = parseArgs(["node", "script", "--name", "my-skill", "https://github.com/user/repo"]);
      expect(result).toEqual({ url: "https://github.com/user/repo", name: "my-skill" });
    });

    it("exits when no URL provided", () => {
      expect(() => parseArgs(["node", "script"])).toThrow("Usage:");
    });

    it("exits for invalid URL", () => {
      expect(() => parseArgs(["node", "script", "not-a-url"])).toThrow("invalid git URL");
    });

    it("exits for empty --name", () => {
      expect(() =>
        parseArgs(["node", "script", "https://github.com/user/repo", "--name", "  "]),
      ).toThrow("--name must not be empty");
    });

    it("exits for --name with invalid characters", () => {
      expect(() =>
        parseArgs(["node", "script", "https://github.com/user/repo", "--name", "../etc"]),
      ).toThrow("--name contains invalid characters");
    });

    it("exits when --name value starts with --", () => {
      expect(() =>
        parseArgs(["node", "script", "https://github.com/user/repo", "--name", "--verbose"]),
      ).toThrow("--name value must not start with --");
    });

    it("accepts SSH URL format", () => {
      const result = parseArgs(["node", "script", "git@github.com:user/repo.git"]);
      expect(result).toEqual({ url: "git@github.com:user/repo.git", name: null });
    });
  });

  describe("deriveNameFromUrl", () => {
    it("extracts repo name from HTTPS URL", () => {
      expect(deriveNameFromUrl("https://github.com/user/my-skill")).toBe("my-skill");
    });

    it("strips .git suffix", () => {
      expect(deriveNameFromUrl("https://github.com/user/my-skill.git")).toBe("my-skill");
    });

    it("strips trailing slashes", () => {
      expect(deriveNameFromUrl("https://github.com/user/my-skill/")).toBe("my-skill");
    });

    it("strips both trailing slashes and .git", () => {
      expect(deriveNameFromUrl("https://github.com/user/my-skill.git///")).toBe("my-skill");
    });

    it("handles SSH URL format", () => {
      expect(deriveNameFromUrl("git@github.com:user/my-skill.git")).toBe("my-skill");
    });
  });

  describe("isWithinDir", () => {
    it("returns true when child is inside parent", () => {
      expect(isWithinDir("/root/skills", "/root/skills/my-skill")).toBe(true);
    });

    it("returns true when child equals parent (identity case)", () => {
      expect(isWithinDir("/root/skills", "/root/skills")).toBe(true);
    });

    it("returns false when child is outside parent", () => {
      expect(isWithinDir("/root/skills", "/root/other/my-skill")).toBe(false);
    });

    it("prevents prefix attacks", () => {
      expect(isWithinDir("/root/skills", "/root/skills-evil/attack")).toBe(false);
    });
  });

  describe("rollback", () => {
    it("removes directory when within skillsRoot", () => {
      mockExistsSync.mockReturnValue(true);
      rollback("/root/skills", "/root/skills/my-skill");
      expect(mockRmSync).toHaveBeenCalledWith("/root/skills/my-skill", {
        recursive: true,
        force: true,
      });
    });

    it("does not remove directory outside skillsRoot", () => {
      mockExistsSync.mockReturnValue(true);
      rollback("/root/skills", "/root/other/my-skill");
      expect(mockRmSync).not.toHaveBeenCalled();
    });

    it("does not remove if directory does not exist", () => {
      mockExistsSync.mockReturnValue(false);
      rollback("/root/skills", "/root/skills/my-skill");
      expect(mockRmSync).not.toHaveBeenCalled();
    });
  });
});
