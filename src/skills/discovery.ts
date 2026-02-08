import { readdir, stat as fsStat, access } from "node:fs/promises";
import { resolve, join, relative, isAbsolute } from "node:path";
import { readSkillManifest, validateManifest, type SkillManifest } from "./manifest.js";
import { createLogger } from "../logging.js";

const log = createLogger("skill:discovery");

export type DiscoveredSkill = {
  dir: string;
  manifest: SkillManifest;
  entryPoint: string;
};

export async function discoverSkills(skillsDir: string): Promise<DiscoveredSkill[]> {
  try {
    await access(skillsDir);
  } catch {
    return [];
  }

  const entries = await readdir(skillsDir);
  const discovered: DiscoveredSkill[] = [];

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const skillDir = resolve(skillsDir, entry);
    let entryStat;
    try {
      entryStat = await fsStat(skillDir);
    } catch {
      continue;
    }
    if (!entryStat.isDirectory()) {
      continue;
    }

    const manifest = await readSkillManifest(skillDir);
    if (!manifest) {
      continue;
    }

    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      for (const err of errors) {
        log.warn(`Skill ${entry}: ${err}`);
      }
      continue;
    }

    const entryFile = manifest.entry ?? "index.ts";
    const entryPoint = resolve(skillDir, entryFile);
    const rel = relative(skillDir, entryPoint);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      log.warn(`Skill ${entry}: entry point escapes skill directory`);
      continue;
    }

    try {
      await access(entryPoint);
    } catch {
      continue;
    }

    discovered.push({ dir: skillDir, manifest, entryPoint });
  }

  return discovered;
}
