import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
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
    const skillDir = resolve(skillsDir, entry);
    const stat = statSync(skillDir);
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

    if (!existsSync(entryPoint)) {
      continue;
    }

    discovered.push({ dir: skillDir, manifest, entryPoint });
  }

  return discovered;
}
