import { config } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createLogger } from "../logging.js";

const log = createLogger("dotenv");

export function loadDotenv(dir?: string): void {
  const baseDir = dir ?? process.cwd();
  const envPath = resolve(baseDir, ".env");
  if (existsSync(envPath)) {
    const result = config({ path: envPath });
    if (result.error) {
      log.warn("Failed to parse .env file:", result.error);
    }
  }
}
