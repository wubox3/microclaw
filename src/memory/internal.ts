import { createHash } from "node:crypto";

const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 64;

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;

  for (const line of lines) {
    currentChunk.push(line);
    currentSize += line.length + 1;

    if (currentSize >= chunkSize) {
      chunks.push(currentChunk.join("\n"));
      // Keep enough trailing lines to cover the overlap in characters,
      // but cap at half the chunk to prevent near-100% duplication with short lines
      let overlapSize = 0;
      let overlapLines = 0;
      const maxOverlapLines = Math.max(1, Math.floor(currentChunk.length / 2));
      for (let i = currentChunk.length - 1; i >= 0 && overlapSize < overlap && overlapLines < maxOverlapLines; i--) {
        overlapSize += currentChunk[i]!.length + 1;
        overlapLines++;
      }
      if (currentChunk.length === 1 && currentChunk[0].length > chunkSize) {
        currentChunk = []; // No overlap for oversized single lines
      } else {
        currentChunk = currentChunk.slice(-Math.max(1, overlapLines));
      }
      currentSize = currentChunk.reduce((sum, l) => sum + l.length + 1, 0);
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join("\n"));
  }

  return chunks;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  const result = denominator === 0 ? 0 : dotProduct / denominator;
  return Number.isNaN(result) ? 0 : result;
}

export function truncateSnippet(text: string, maxLength = 200): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + "...";
}
