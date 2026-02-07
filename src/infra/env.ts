export function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function optionalEnv(key: string, fallback?: string): string | undefined {
  const val = process.env[key];
  return val && val.trim() ? val.trim() : fallback;
}

export function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}
