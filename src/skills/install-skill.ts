import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path, { resolve, basename } from "node:path";
import { readSkillManifest, validateManifest } from "./manifest.js";

export const VALID_DIR_NAME = /^(?!\.$)(?!\.\.$)[a-zA-Z0-9._-]+$/;
export const VALID_GIT_URL = /^(https?:\/\/[^\s]+|git@[^\s:]+:[^\s]+|git:\/\/[^\s]+)$/;

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
    console.error("Usage: tsx src/skills/install-skill.ts <git-url> [--name <dir-name>]");
    process.exit(1);
  }

  if (!VALID_GIT_URL.test(url)) {
    console.error("Error: invalid git URL — must be https://, git://, or git@ format");
    process.exit(1);
  }

  if (name !== null && name.length === 0) {
    console.error("Error: --name must not be empty");
    process.exit(1);
  }

  if (name !== null && !VALID_DIR_NAME.test(name)) {
    console.error("Error: --name contains invalid characters (use alphanumeric, hyphens, underscores, dots)");
    process.exit(1);
  }

  return { url, name };
}

export function deriveNameFromUrl(url: string): string {
  const cleaned = url.replace(/\/+$/, "").replace(/\.git$/, "");
  return basename(cleaned);
}

export function isWithinDir(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
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

function run(): void {
  const { url, name } = parseArgs(process.argv);
  const dirName = name ?? deriveNameFromUrl(url);

  if (!VALID_DIR_NAME.test(dirName)) {
    console.error("Error: derived directory name contains invalid characters — use --name to override");
    process.exit(1);
  }

  const skillsRoot = resolve(process.cwd(), "skills");
  const targetDir = resolve(skillsRoot, dirName);

  if (!isWithinDir(skillsRoot, targetDir)) {
    console.error("Error: skill name resolves outside the skills directory");
    process.exit(1);
  }

  if (existsSync(targetDir)) {
    console.error(`Error: skill directory already exists: ${targetDir}`);
    process.exit(1);
  }

  console.error(`Cloning ${url} into skills/${dirName}...`);
  try {
    cloneRepo(url, targetDir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const manifest = readSkillManifest(targetDir);
  if (!manifest) {
    console.error("Error: no valid microclaw.skill.json found in repository");
    rollback(skillsRoot, targetDir);
    process.exit(1);
  }

  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    console.error("Manifest validation failed:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    rollback(skillsRoot, targetDir);
    process.exit(1);
  }

  const entryFile = manifest.entry ?? "index.ts";
  const entryPoint = resolve(targetDir, entryFile);

  if (!isWithinDir(targetDir, entryPoint)) {
    console.error(`Error: entry point escapes skill directory: ${entryFile}`);
    rollback(skillsRoot, targetDir);
    process.exit(1);
  }

  if (!existsSync(entryPoint)) {
    console.error(`Error: entry point not found: ${entryFile}`);
    rollback(skillsRoot, targetDir);
    process.exit(1);
  }

  console.error(`Installed skill "${manifest.name}" (${manifest.id}) into skills/${dirName}`);
}

// Only run when executed directly, not when imported by tests
const isDirectExecution = process.argv[1]?.endsWith("install-skill.ts") ?? false;
if (isDirectExecution) {
  run();
}
