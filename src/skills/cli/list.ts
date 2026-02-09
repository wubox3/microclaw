import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { readLockFile } from "../registry/lockfile.js";

async function main(): Promise<void> {
  try {
    const projectRoot = process.cwd();
    const skillsRoot = resolve(projectRoot, "skills");
    const lockFile = readLockFile(projectRoot);
    const slugs = Object.keys(lockFile.skills).sort();

    if (slugs.length === 0) {
      console.error("No registry skills installed.");
      console.error('Use "pnpm skill:install <slug>" to install a skill from the registry.');
      return;
    }

    console.error(`Installed registry skills (${slugs.length}):\n`);
    for (const slug of slugs) {
      const entry = lockFile.skills[slug];
      const dirExists = existsSync(resolve(skillsRoot, slug));
      const status = dirExists ? "OK" : "MISSING";
      console.log(`  ${slug}@${entry.version}  [${status}]`);
      console.log(`    installed: ${entry.installedAt}`);
      console.log(`    registry: ${entry.registryUrl}`);
      console.log();
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
