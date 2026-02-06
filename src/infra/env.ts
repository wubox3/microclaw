export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function optionalEnv(key: string, fallback?: string): string | undefined {
  return process.env[key] ?? fallback;
}

export function getAnthropicApiKey(): string {
  return requireEnv("ANTHROPIC_API_KEY");
}

export function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}
