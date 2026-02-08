import { resolve, join } from "node:path";
import os from "node:os";
import type { MicroClawConfig } from "./types.js";
import { createLogger } from "../logging.js";

const log = createLogger("paths");

/**
 * Expand a user-supplied path: resolve ~ to homedir, make relative paths
 * absolute against the given base directory.
 */
export function expandPath(raw: string, baseDir: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return baseDir;
  }
  if (trimmed === "~" || trimmed.startsWith("~/")) {
    return resolve(trimmed.replace(/^~/, os.homedir()));
  }
  return resolve(baseDir, trimmed);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ResolvedPaths = {
  /** Absolute project root (captured from process.cwd() at startup) */
  readonly projectRoot: string;
  /** Absolute data directory for memory, settings, etc. */
  readonly dataDir: string;
  /** Absolute skills directory */
  readonly skillsDir: string;
  /** Absolute cron store directory */
  readonly cronStorePath: string;
};

/**
 * Resolve all application paths once at startup.
 * Captures process.cwd() exactly once so all paths are consistent
 * even if the working directory changes later.
 */
export function resolvePaths(config: MicroClawConfig): ResolvedPaths {
  const projectRoot = resolve(process.cwd());

  const dataDir = config.memory?.dataDir
    ? expandPath(config.memory.dataDir, projectRoot)
    : join(projectRoot, ".microclaw");

  const skillsDir = config.skills?.directory
    ? expandPath(config.skills.directory, projectRoot)
    : join(projectRoot, "skills");

  const cronStorePath = config.cron?.store
    ? expandPath(config.cron.store, projectRoot)
    : join(dataDir, "cron");

  return Object.freeze({ projectRoot, dataDir, skillsDir, cronStorePath });
}
