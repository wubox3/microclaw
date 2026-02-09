import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path, { basename } from "node:path";

export const VALID_DIR_NAME = /^(?!\.)(?!\.\.$)[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export const VALID_GIT_URL = /^(https?:\/\/[^\s"'`]+$|git@[^\s:"'`]+:[^\s"'`]+$|git:\/\/[^\s"'`]+$)$/;

export function parseArgs(argv: readonly string[]): { url: string; name: string | null } {
  const args = argv.slice(2);
  const nameIndex = args.indexOf("--name");
  const name = nameIndex >= 0 && nameIndex + 1 < args.length
    ? args[nameIndex + 1].trim()
    : null;
  const nameValueIndex = nameIndex >= 0 ? nameIndex + 1 : -1;
  const positional = args.filter(
    (a, i) => !a.startsWith("--") && i !== nameIndex && i !== nameValueIndex,
  );
  const url = positional[0] ?? null;

  if (!url) {
    throw new Error("Usage: tsx src/skills/install-skill.ts <git-url> [--name <dir-name>]");
  }

  if (url.startsWith("ext::")) {
    throw new Error("Error: ext:: git protocol is not allowed");
  }

  if (!VALID_GIT_URL.test(url)) {
    throw new Error("Error: invalid git URL — must be https://, git://, or git@ format");
  }

  if (name !== null && name.startsWith("--")) {
    throw new Error("Error: --name value must not start with --");
  }

  if (name !== null && name.length === 0) {
    throw new Error("Error: --name must not be empty");
  }

  if (name !== null && !VALID_DIR_NAME.test(name)) {
    throw new Error("Error: --name contains invalid characters (use alphanumeric, hyphens, underscores, dots)");
  }

  return { url, name };
}

export function deriveNameFromUrl(url: string): string {
  const cleaned = url.replace(/\/+$/, "").replace(/\.git$/, "");
  return basename(cleaned);
}

export function isWithinDir(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function cloneRepo(url: string, targetDir: string): void {
  try {
    execFileSync("git", ["clone", "--depth", "1", url, targetDir], {
      stdio: "pipe",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git clone failed: ${message}`);
  }
}

export function rollback(skillsRoot: string, targetDir: string): void {
  if (isWithinDir(skillsRoot, targetDir) && existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
}

