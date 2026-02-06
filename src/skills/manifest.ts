import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export type SkillManifest = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  entry?: string;
  configSchema?: Record<string, unknown>;
};

const MANIFEST_FILENAME = "microclaw.skill.json";

export function readSkillManifest(skillDir: string): SkillManifest | null {
  const manifestPath = resolve(skillDir, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    const raw = readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as SkillManifest;
  } catch {
    return null;
  }
}

export function validateManifest(manifest: SkillManifest): string[] {
  const errors: string[] = [];
  if (!manifest.id) {
    errors.push("Manifest missing required field: id");
  }
  if (!manifest.name) {
    errors.push("Manifest missing required field: name");
  }
  return errors;
}
