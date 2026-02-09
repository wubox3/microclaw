import { resolve } from "node:path";
import { installSkillFromRegistry } from "../registry/install.js";

function parseArgs(argv: readonly string[]): {
  slug: string;
  version?: string;
  force: boolean;
} {
  const args = argv.slice(2);
  const forceIdx = args.indexOf("--force");
  const force = forceIdx >= 0;

  const versionIdx = args.indexOf("--version");
  const version =
    versionIdx >= 0 && versionIdx + 1 < args.length ? args[versionIdx + 1] : undefined;

  const skipIndices = new Set<number>();
  if (forceIdx >= 0) skipIndices.add(forceIdx);
  if (versionIdx >= 0) {
    skipIndices.add(versionIdx);
    skipIndices.add(versionIdx + 1);
  }

  const positional = args.filter((_, i) => !skipIndices.has(i) && !args[i].startsWith("--"));
  const slug = positional[0];

  if (!slug) {
    throw new Error("Usage: pnpm skill:install <slug> [--version <v>] [--force]");
  }

  return { slug, version, force };
}

async function main(): Promise<void> {
  try {
    const { slug, version, force } = parseArgs(process.argv);
    const projectRoot = process.cwd();
    const skillsRoot = resolve(projectRoot, "skills");

    console.error(`Installing skill "${slug}"${version ? `@${version}` : ""}...`);

    const result = await installSkillFromRegistry({
      slug,
      version,
      force,
      projectRoot,
      skillsRoot,
    });

    console.error(`Installed "${result.skillName}" (${result.version}) into ${result.directory}`);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
