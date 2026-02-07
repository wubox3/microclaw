import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { readSkillManifest, validateManifest, type SkillManifest } from "./manifest.js";
import { createLogger } from "../logging.js";

const log = createLogger("skill:discovery");

export type DiscoveredSkill = {
  dir: string;
  manifest: SkillManifest;
  entryPoint: string;
};

export function discoverSkills(skillsDir: string): DiscoveredSkill[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const entries = readdirSync(skillsDir);
  const discovered: DiscoveredSkill[] = [];

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const skillDir = resolve(skillsDir, entry);
    let stat;
    try {
      stat = statSync(skillDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      continue;
    }

    const manifest = readSkillManifest(skillDir);
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

    if (!existsSync(entryPoint)) {
      continue;
    }

    discovered.push({ dir: skillDir, manifest, entryPoint });
  }

  return discovered;
}
