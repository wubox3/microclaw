import { resolve } from "node:path";
import { updateSkill, updateAllSkills } from "../registry/install.js";

function parseArgs(argv: readonly string[]): { slug?: string; all: boolean } {
  const args = argv.slice(2);
  const allFlag = args.includes("--all");
  const positional = args.filter((a) => !a.startsWith("--"));
  const slug = positional[0];

  if (!slug && !allFlag) {
    throw new Error("Usage: pnpm skill:update <slug> or pnpm skill:update --all");
  }

  return { slug: allFlag ? undefined : slug, all: allFlag };
}

async function main(): Promise<void> {
  try {
    const { slug, all } = parseArgs(process.argv);
    const projectRoot = process.cwd();
    const skillsRoot = resolve(projectRoot, "skills");

    if (all) {
      console.error("Checking all installed skills for updates...");
      const results = await updateAllSkills({ projectRoot, skillsRoot });

      if (results.length === 0) {
        console.error("All skills are up to date.");
        return;
      }

      for (const result of results) {
        console.error(
          `Updated "${result.skillName}" (${result.slug}): ${result.previousVersion} -> ${result.newVersion}`,
        );
      }
      console.error(`\n${results.length} skill(s) updated.`);
    } else if (slug) {
      console.error(`Checking "${slug}" for updates...`);
      const result = await updateSkill({ slug, projectRoot, skillsRoot });

      if (!result) {
        console.error(`"${slug}" is already at the latest version.`);
        return;
      }

      console.error(
        `Updated "${result.skillName}" (${result.slug}): ${result.previousVersion} -> ${result.newVersion}`,
      );
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
