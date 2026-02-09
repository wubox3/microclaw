import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";

const TMP_ROOT = path.join(import.meta.dirname, "__test_install_tmp__");
const PROJECT_ROOT = TMP_ROOT;
const SKILLS_ROOT = path.join(TMP_ROOT, "skills");

vi.mock("./client.js", () => ({
  resolveRegistryUrl: () => "https://www.eclaw.ai",
  getSkillInfo: vi.fn(),
  downloadSkillZip: vi.fn(),
  getSkillVersions: vi.fn(),
}));

import { getSkillInfo, downloadSkillZip } from "./client.js";
import { installSkillFromRegistry, updateSkill, updateAllSkills } from "./install.js";
import { readLockFile, writeLockFile, addLockEntry } from "./lockfile.js";
import type { LockFile } from "./types.js";

function createTestZip(skillName: string): Buffer {
  const tmpDir = path.join(TMP_ROOT, "zip-build");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(path.join(tmpDir, "SKILL.md"), `---\nname: ${skillName}\n---\nA skill`);

  const zipPath = path.join(TMP_ROOT, "build.zip");
  execFileSync("zip", ["-r", zipPath, "."], { cwd: tmpDir, stdio: "pipe" });
  const buf = readFileSync(zipPath);

  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
  return buf;
}

beforeEach(() => {
  mkdirSync(SKILLS_ROOT, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("installSkillFromRegistry", () => {
  it("installs a skill from the registry", async () => {
    vi.mocked(getSkillInfo).mockResolvedValueOnce({
      slug: "calendar",
      name: "Calendar",
      description: "A calendar skill",
      latestVersion: "1.0.0",
    });
    vi.mocked(downloadSkillZip).mockResolvedValueOnce(createTestZip("Calendar"));

    const result = await installSkillFromRegistry({
      slug: "calendar",
      projectRoot: PROJECT_ROOT,
      skillsRoot: SKILLS_ROOT,
    });

    expect(result.slug).toBe("calendar");
    expect(result.version).toBe("1.0.0");
    expect(result.skillName).toBe("Calendar");
    expect(existsSync(path.join(SKILLS_ROOT, "calendar", "SKILL.md"))).toBe(true);

    const lock = readLockFile(PROJECT_ROOT);
    expect(lock.skills.calendar).toBeDefined();
    expect(lock.skills.calendar.version).toBe("1.0.0");
  });

  it("uses specified version instead of latest", async () => {
    vi.mocked(getSkillInfo).mockResolvedValueOnce({
      slug: "calendar",
      name: "Calendar",
      description: "A calendar skill",
      latestVersion: "2.0.0",
    });
    vi.mocked(downloadSkillZip).mockResolvedValueOnce(createTestZip("Calendar"));

    const result = await installSkillFromRegistry({
      slug: "calendar",
      version: "1.5.0",
      projectRoot: PROJECT_ROOT,
      skillsRoot: SKILLS_ROOT,
    });

    expect(result.version).toBe("1.5.0");
  });

  it("throws on invalid slug", async () => {
    await expect(
      installSkillFromRegistry({
        slug: "../escape",
        projectRoot: PROJECT_ROOT,
        skillsRoot: SKILLS_ROOT,
      }),
    ).rejects.toThrow("Invalid skill slug");
  });

  it("throws when directory exists without --force", async () => {
    mkdirSync(path.join(SKILLS_ROOT, "calendar"), { recursive: true });

    await expect(
      installSkillFromRegistry({
        slug: "calendar",
        projectRoot: PROJECT_ROOT,
        skillsRoot: SKILLS_ROOT,
      }),
    ).rejects.toThrow("already exists");
  });

  it("allows overwrite with --force", async () => {
    mkdirSync(path.join(SKILLS_ROOT, "calendar"), { recursive: true });
    vi.mocked(getSkillInfo).mockResolvedValueOnce({
      slug: "calendar",
      name: "Calendar",
      description: "A calendar skill",
      latestVersion: "1.0.0",
    });
    vi.mocked(downloadSkillZip).mockResolvedValueOnce(createTestZip("Calendar"));

    const result = await installSkillFromRegistry({
      slug: "calendar",
      force: true,
      projectRoot: PROJECT_ROOT,
      skillsRoot: SKILLS_ROOT,
    });

    expect(result.slug).toBe("calendar");
  });

  it("rolls back on extraction failure", async () => {
    vi.mocked(getSkillInfo).mockResolvedValueOnce({
      slug: "bad-skill",
      name: "Bad",
      description: "Broken skill",
      latestVersion: "1.0.0",
    });
    vi.mocked(downloadSkillZip).mockResolvedValueOnce(Buffer.from("not-a-zip"));

    await expect(
      installSkillFromRegistry({
        slug: "bad-skill",
        projectRoot: PROJECT_ROOT,
        skillsRoot: SKILLS_ROOT,
      }),
    ).rejects.toThrow();

    expect(existsSync(path.join(SKILLS_ROOT, "bad-skill"))).toBe(false);
  });
});

describe("updateSkill", () => {
  it("returns null when already at latest version", async () => {
    const lock: LockFile = addLockEntry(
      { version: 1, skills: {} },
      { slug: "calendar", version: "1.0.0", installedAt: "2026-01-01T00:00:00Z", registryUrl: "https://www.eclaw.ai" },
    );
    writeLockFile(PROJECT_ROOT, lock);

    vi.mocked(getSkillInfo).mockResolvedValueOnce({
      slug: "calendar",
      name: "Calendar",
      description: "A calendar skill",
      latestVersion: "1.0.0",
    });

    const result = await updateSkill({
      slug: "calendar",
      projectRoot: PROJECT_ROOT,
      skillsRoot: SKILLS_ROOT,
    });

    expect(result).toBeNull();
  });

  it("throws when skill is not installed", async () => {
    await expect(
      updateSkill({
        slug: "not-installed",
        projectRoot: PROJECT_ROOT,
        skillsRoot: SKILLS_ROOT,
      }),
    ).rejects.toThrow("not installed");
  });

  it("updates when newer version is available", async () => {
    mkdirSync(path.join(SKILLS_ROOT, "calendar"), { recursive: true });
    const lock: LockFile = addLockEntry(
      { version: 1, skills: {} },
      { slug: "calendar", version: "1.0.0", installedAt: "2026-01-01T00:00:00Z", registryUrl: "https://www.eclaw.ai" },
    );
    writeLockFile(PROJECT_ROOT, lock);

    vi.mocked(getSkillInfo)
      .mockResolvedValueOnce({
        slug: "calendar",
        name: "Calendar",
        description: "A calendar skill",
        latestVersion: "2.0.0",
      })
      .mockResolvedValueOnce({
        slug: "calendar",
        name: "Calendar",
        description: "A calendar skill",
        latestVersion: "2.0.0",
      });
    vi.mocked(downloadSkillZip).mockResolvedValueOnce(createTestZip("Calendar v2"));

    const result = await updateSkill({
      slug: "calendar",
      projectRoot: PROJECT_ROOT,
      skillsRoot: SKILLS_ROOT,
    });

    expect(result).not.toBeNull();
    expect(result!.previousVersion).toBe("1.0.0");
    expect(result!.newVersion).toBe("2.0.0");
  });
});

describe("updateAllSkills", () => {
  it("returns empty array when no skills are installed", async () => {
    const results = await updateAllSkills({
      projectRoot: PROJECT_ROOT,
      skillsRoot: SKILLS_ROOT,
    });
    expect(results).toEqual([]);
  });
});
