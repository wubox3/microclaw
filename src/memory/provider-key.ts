export function buildProviderKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

export function parseProviderKey(key: string): { provider: string; model: string } | null {
  const idx = key.indexOf(":");
  if (idx === -1) {
    return null;
  }
  return {
    provider: key.slice(0, idx),
    model: key.slice(idx + 1),
  };
}
