import fs from "node:fs";
import path from "node:path";

function looksLikeSkillsDir(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        return true;
      }
      if (entry.isDirectory()) {
        const fullPath = path.join(dir, entry.name);
        if (fs.existsSync(path.join(fullPath, "SKILL.md"))) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

export const ECLAW_BUNDLED_SKILLS_DIR_ENV = "ECLAW_BUNDLED_SKILLS_DIR";

export function resolveBundledSkillsDir(): string | undefined {
  const override = process.env[ECLAW_BUNDLED_SKILLS_DIR_ENV]?.trim();
  if (override) {
    return override;
  }

  // Resolve relative to cwd
  const cwd = process.cwd();
  const candidate = path.join(cwd, "skills");
  if (looksLikeSkillsDir(candidate)) {
    return candidate;
  }

  // Walk up from cwd looking for a skills directory
  let current = cwd;
  for (let depth = 0; depth < 6; depth += 1) {
    const check = path.join(current, "skills");
    if (looksLikeSkillsDir(check)) {
      return check;
    }
    const next = path.dirname(current);
    if (next === current) {
      break;
    }
    current = next;
  }

  return undefined;
}
