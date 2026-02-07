import type { EmbeddingResult } from "./types.js";

export type EmbeddingProvider = {
  model: string;
  dimensions: number;
  embed: (texts: string[]) => Promise<EmbeddingResult[]>;
};

const DEFAULT_MODEL = "voyage-3";
const DEFAULT_DIMENSIONS = 1024;

export function createAnthropicEmbeddingProvider(apiKey: string): EmbeddingProvider {
  let actualDimensions = DEFAULT_DIMENSIONS;
  return {
    model: DEFAULT_MODEL,
    get dimensions() { return actualDimensions; },
    embed: async (texts: string[]): Promise<EmbeddingResult[]> => {
      // Voyage models are accessed via Anthropic's API
      // Using the messages API to generate embeddings via tool use
      // For now, use a direct fetch to the Voyage API endpoint
      const response = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          input: texts,
          input_type: "document",
        }),
      });

      if (!response.ok) {
        throw new Error(`Voyage embedding API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[]; index: number }>;
        model: string;
      };

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error("Voyage embedding API returned unexpected response format");
      }

      const results = data.data.map((item) => ({
        embedding: item.embedding,
        model: data.model,
        dimensions: item.embedding.length,
      }));
      actualDimensions = results[0]?.embedding.length ?? actualDimensions;
      return results;
    },
  };
}

export function providerKey(provider: EmbeddingProvider): string {
  return `anthropic:${provider.model}`;
}
