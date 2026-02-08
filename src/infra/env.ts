export function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function optionalEnv(key: string, fallback?: string): string | undefined {
  const val = process.env[key];
  const trimmed = val?.trim();
  return trimmed ? trimmed : fallback;
}

export function isDev(): boolean {
  return process.env.NODE_ENV === "development";
}
