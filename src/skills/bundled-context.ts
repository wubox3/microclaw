import { loadSkillsFromDir } from "./skill-loader.js";
import { resolveBundledSkillsDir } from "./bundled-dir.js";
import { createLogger } from "../logging.js";

const log = createLogger("skills");
let hasWarnedMissingBundledDir = false;

export type BundledSkillsContext = {
  dir?: string;
  names: Set<string>;
};

export function resolveBundledSkillsContext(): BundledSkillsContext {
  const dir = resolveBundledSkillsDir();
  const names = new Set<string>();
  if (!dir) {
    if (!hasWarnedMissingBundledDir) {
      hasWarnedMissingBundledDir = true;
      log.warn("Bundled skills directory could not be resolved; built-in skills may be missing.");
    }
    return { dir, names };
  }
  const result = loadSkillsFromDir({ dir, source: "eclaw-bundled" });
  for (const skill of result.skills) {
    if (skill.name.trim()) {
      names.add(skill.name);
    }
  }
  return { dir, names };
}
