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
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function normalizeE164(phone: string): string {
  const cleaned = phone.replace(/[^+\d]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
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
