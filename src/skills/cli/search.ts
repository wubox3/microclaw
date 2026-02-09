import { searchSkills } from "../registry/client.js";

function parseArgs(argv: readonly string[]): { query: string; limit?: number } {
  const args = argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limitRaw = limitIdx >= 0 && limitIdx + 1 < args.length ? args[limitIdx + 1] : undefined;
  const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;

  const skipIndices = new Set<number>();
  if (limitIdx >= 0) {
    skipIndices.add(limitIdx);
    skipIndices.add(limitIdx + 1);
  }

  const positional = args.filter((_, i) => !skipIndices.has(i) && !args[i].startsWith("--"));
  const query = positional.join(" ").trim();

  if (!query) {
    throw new Error('Usage: pnpm skill:search "<query>" [--limit <n>]');
  }

  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }

  return { query, limit };
}

async function main(): Promise<void> {
  try {
    const { query, limit } = parseArgs(process.argv);
    console.error(`Searching for "${query}"...`);

    const response = await searchSkills({ query, limit });

    if (response.results.length === 0) {
      console.error("No skills found.");
      return;
    }

    console.error(`Found ${response.results.length} skill(s):\n`);
    for (const skill of response.results) {
      const version = skill.latestVersion ? ` (${skill.latestVersion})` : "";
      const author = skill.author ? ` by ${skill.author}` : "";
      console.log(`  ${skill.slug}${version}${author}`);
      console.log(`    ${skill.description}`);
      console.log();
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
