import type { EmbeddingResult } from "./types.js";
import { chunk } from "../utils.js";

const BATCH_SIZE = 32;
const RATE_LIMIT_DELAY_MS = 200;

export async function batchEmbed(
  provider: { embed: (texts: string[]) => Promise<EmbeddingResult[]> },
  texts: string[],
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) {
    return [];
  }

  const batches = chunk(texts, BATCH_SIZE);
  const results: EmbeddingResult[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const batchResults = await provider.embed(batch);
    results.push(...batchResults);

    // Rate limiting between batches
    if (i < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }
  }

  return results;
}
