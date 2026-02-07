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
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    if (typeof parsed.id !== "string" || typeof parsed.name !== "string") {
      return null;
    }
    // Reject entry fields with path traversal segments
    if (typeof parsed.entry === "string") {
      const segments = parsed.entry.split(/[/\\]/);
      if (segments.some((s: string) => s === "..")) {
        return null;
      }
    }
    return parsed as unknown as SkillManifest;
  } catch {
    return null;
  }
}

const SKILL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_SKILL_ID_LENGTH = 64;

export function validateManifest(manifest: SkillManifest): string[] {
  const errors: string[] = [];
  if (!manifest.id) {
    errors.push("Manifest missing required field: id");
  } else if (manifest.id.length > MAX_SKILL_ID_LENGTH) {
    errors.push("Manifest id must be at most " + String(MAX_SKILL_ID_LENGTH) + " characters");
  } else if (!SKILL_ID_PATTERN.test(manifest.id)) {
    errors.push("Manifest id must match [a-zA-Z0-9_-]+");
  }
  if (!manifest.name) {
    errors.push("Manifest missing required field: name");
  } else if (manifest.name.length > 128) {
    errors.push("Manifest name must be at most 128 characters");
  }
  return errors;
}
