import { config } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

export function loadDotenv(dir?: string): void {
  const baseDir = dir ?? process.cwd();
  const envPath = resolve(baseDir, ".env");
  if (existsSync(envPath)) {
    config({ path: envPath });
  }
}
