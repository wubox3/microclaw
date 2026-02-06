import path from "path";
import os from "os";

const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || os.homedir();

function parseIntSafe(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || "microclaw-agent:latest";

export const CONTAINER_TIMEOUT = parseIntSafe(
  process.env.CONTAINER_TIMEOUT,
  300000,
);

export const CONTAINER_MAX_OUTPUT_SIZE = parseIntSafe(
  process.env.CONTAINER_MAX_OUTPUT_SIZE,
  10485760,
);

export const IPC_POLL_INTERVAL = 1000;

export const OUTPUT_START_MARKER = "---MICROCLAW_OUTPUT_START---";
export const OUTPUT_END_MARKER = "---MICROCLAW_OUTPUT_END---";

export const DATA_DIR = path.resolve(PROJECT_ROOT, "data");

export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  ".config",
  "microclaw",
  "mount-allowlist.json",
);
