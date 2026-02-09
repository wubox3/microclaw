import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VALID_DIR_NAME, isWithinDir, rollback } from "../install-skill.js";
import { parseFrontmatter } from "../frontmatter.js";
import { bumpSkillsSnapshotVersion } from "../refresh.js";
import { getSkillInfo, downloadSkillZip, resolveRegistryUrl } from "./client.js";
import { readLockFile, writeLockFile, addLockEntry, getLockEntry } from "./lockfile.js";
import { extractZipToDir } from "./extract.js";
import type { LockEntry } from "./types.js";

export type InstallResult = {
  slug: string;
  version: string;
  skillName: string;
  directory: string;
};

export type UpdateResult = {
  slug: string;
  previousVersion: string;
  newVersion: string;
  skillName: string;
};

export async function installSkillFromRegistry(params: {
  slug: string;
  version?: string;
  force?: boolean;
  projectRoot: string;
  skillsRoot: string;
}): Promise<InstallResult> {
  const { slug, version, force, projectRoot, skillsRoot } = params;

  if (!VALID_DIR_NAME.test(slug)) {
    throw new Error(`Invalid skill slug: "${slug}" — must be alphanumeric with hyphens/underscores/dots`);
  }

  const targetDir = resolve(skillsRoot, slug);

  if (!isWithinDir(skillsRoot, targetDir)) {
    throw new Error("Skill slug resolves outside the skills directory");
  }

  if (existsSync(targetDir) && !force) {
    throw new Error(`Skill directory already exists: skills/${slug} (use --force to overwrite)`);
  }

  const info = await getSkillInfo(slug);
  const resolvedVersion = version ?? info.latestVersion;

  const zipBuffer = await downloadSkillZip({ slug, version: resolvedVersion });

  try {
    extractZipToDir({ zipBuffer, targetDir, skillsRoot });

    const skillMdPath = resolve(targetDir, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      throw new Error("Downloaded skill does not contain a SKILL.md file");
    }

    const skillName = readSkillNameFromDir(targetDir) ?? info.name;

    const lockFile = readLockFile(projectRoot);
    const entry: LockEntry = {
      slug,
      version: resolvedVersion,
      installedAt: new Date().toISOString(),
      registryUrl: resolveRegistryUrl(),
    };
    writeLockFile(projectRoot, addLockEntry(lockFile, entry));

    bumpSkillsSnapshotVersion({ reason: "manual" });

    return {
      slug,
      version: resolvedVersion,
      skillName,
      directory: `skills/${slug}`,
    };
  } catch (error) {
    rollback(skillsRoot, targetDir);
    throw error;
  }
}

export async function updateSkill(params: {
  slug: string;
  projectRoot: string;
  skillsRoot: string;
}): Promise<UpdateResult | null> {
  const { slug, projectRoot, skillsRoot } = params;
  const lockFile = readLockFile(projectRoot);
  const existing = getLockEntry(lockFile, slug);

  if (!existing) {
    throw new Error(`Skill "${slug}" is not installed (not found in lock file)`);
  }

  const info = await getSkillInfo(slug);

  if (info.latestVersion === existing.version) {
    return null;
  }

  const result = await installSkillFromRegistry({
    slug,
    version: info.latestVersion,
    force: true,
    projectRoot,
    skillsRoot,
  });

  return {
    slug,
    previousVersion: existing.version,
    newVersion: result.version,
    skillName: result.skillName,
  };
}

export async function updateAllSkills(params: {
  projectRoot: string;
  skillsRoot: string;
}): Promise<UpdateResult[]> {
  const { projectRoot, skillsRoot } = params;
  const lockFile = readLockFile(projectRoot);
  const slugs = Object.keys(lockFile.skills);
  const results: UpdateResult[] = [];

  for (const slug of slugs) {
    const result = await updateSkill({ slug, projectRoot, skillsRoot });
    if (result) {
      results.push(result);
    }
  }

  return results;
}

function readSkillNameFromDir(dir: string): string | undefined {
  const skillMdPath = resolve(dir, "SKILL.md");
  try {
    const content = readFileSync(skillMdPath, "utf-8");
    const frontmatter = parseFrontmatter(content);
    const name = frontmatter["name"];
    return typeof name === "string" ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}
