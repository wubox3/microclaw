export function truncateText(input: string, maxLen: number): string {
  if (input.length <= maxLen) {
    return input;
  }
  return input.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "…";
}
