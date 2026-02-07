export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function truncate(text: string, maxLength: number): string {
  if (maxLength < 1) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength < 4) {
    return text.slice(0, maxLength);
  }
  return text.slice(0, maxLength - 3) + "...";
}

export function chunk<T>(array: readonly T[], size: number): T[][] {
  if (size < 1) {
    throw new Error("chunk size must be at least 1");
  }
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function normalizeE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return "";
  }
  return `+${digits}`;
}

export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash | 0;
  }
  return hash >>> 0;
}

export function uniqueBy<T>(array: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return array.filter((item) => {
    const k = key(item);
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
}

export function groupBy<T>(array: readonly T[], key: (item: T) => string): Record<string, readonly T[]> {
  const groups = new Map<string, T[]>();
  for (const item of array) {
    const k = key(item);
    const existing = groups.get(k);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(k, [item]);
    }
  }
  // Internal arrays are not leaked; the return type enforces readonly
  return Object.fromEntries(groups) as Record<string, readonly T[]>;
}
