export function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function optionalEnv(key: string, fallback?: string): string | undefined {
  return process.env[key] ?? fallback;
}

export function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}
