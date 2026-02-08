import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
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
// Shell PATH resolution
// ---------------------------------------------------------------------------

/** Resolve a path to its real (symlink-free) form. Returns original on failure. */
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// Well-known macOS directories that profile scripts commonly add.
// Ensures tools are discoverable even when started from a non-login context.
const MACOS_WELL_KNOWN_PATHS = [
  // Homebrew (Apple Silicon + Intel)
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  // Apple system paths
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
  // Apple Cryptex paths (macOS 13+)
  "/System/Cryptexes/App/usr/bin",
  "/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin",
  "/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin",
  "/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin",
  // Apple developer tools
  "/Library/Apple/usr/bin",
  "/Library/Developer/CommandLineTools/usr/bin",
  // Xcode
  "/Applications/Xcode.app/Contents/Developer/usr/bin",
  // macOS package managers
  "/opt/local/bin",       // MacPorts
  "/opt/local/sbin",
  "/opt/pkg/bin",         // pkgsrc
] as const;

/**
 * Discover NVM node version paths.
 * NVM installs versions under ~/.nvm/versions/node/<version>/bin.
 */
function resolveNvmPaths(home: string): string[] {
  const nvmDir = process.env.NVM_DIR || join(home, ".nvm");
  const paths: string[] = [];
  try {
    const versionsDir = join(nvmDir, "versions", "node");
    if (existsSync(versionsDir)) {
      for (const v of readdirSync(versionsDir)) {
        const binDir = join(versionsDir, v, "bin");
        if (existsSync(binDir)) {
          paths.push(binDir);
        }
      }
    }
  } catch {
    // NVM not installed
  }
  return paths;
}

/**
 * Discover fnm (Fast Node Manager) paths.
 * fnm installs versions under ~/.fnm/node-versions/<version>/installation/bin
 * and aliases under ~/.fnm/aliases/<name>/bin.
 */
function resolveFnmPaths(home: string): string[] {
  const fnmDir = process.env.FNM_DIR || join(home, ".fnm");
  const paths: string[] = [];
  try {
    const versionsDir = join(fnmDir, "node-versions");
    if (existsSync(versionsDir)) {
      for (const v of readdirSync(versionsDir)) {
        const binDir = join(versionsDir, v, "installation", "bin");
        if (existsSync(binDir)) {
          paths.push(binDir);
        }
      }
    }
    const aliasesDir = join(fnmDir, "aliases");
    if (existsSync(aliasesDir)) {
      for (const alias of readdirSync(aliasesDir)) {
        const binDir = join(aliasesDir, alias, "bin");
        if (existsSync(binDir)) {
          paths.push(binDir);
        }
      }
    }
  } catch {
    // fnm not installed
  }
  return paths;
}

/**
 * Build common user-local tool paths for the given home directory.
 * Includes language version managers, package managers, and dev tools.
 */
function resolveUserToolPaths(home: string): string[] {
  return [
    // XDG / general
    join(home, ".local", "bin"),
    join(home, "bin"),

    // Node.js ecosystem
    join(home, ".bun", "bin"),
    join(home, ".volta", "bin"),
    join(home, "Library", "pnpm"),            // pnpm global (macOS)
    join(home, ".config", "yarn", "global", "node_modules", ".bin"),

    // Rust
    join(home, ".cargo", "bin"),

    // Go
    join(home, "go", "bin"),

    // Python (macOS framework builds)
    join(home, "Library", "Python", "3.9", "bin"),
    join(home, "Library", "Python", "3.10", "bin"),
    join(home, "Library", "Python", "3.11", "bin"),
    join(home, "Library", "Python", "3.12", "bin"),
    join(home, "Library", "Python", "3.13", "bin"),
    // pyenv
    join(home, ".pyenv", "shims"),
    join(home, ".pyenv", "bin"),

    // Ruby
    join(home, ".rbenv", "shims"),
    join(home, ".rbenv", "bin"),
    join(home, ".gem", "bin"),

    // Deno
    join(home, ".deno", "bin"),

    // Java (SDKMAN)
    join(home, ".sdkman", "candidates", "java", "current", "bin"),
    join(home, ".sdkman", "candidates", "gradle", "current", "bin"),
    join(home, ".sdkman", "candidates", "maven", "current", "bin"),

    // mise / rtx (polyglot version manager)
    join(home, ".local", "share", "mise", "shims"),

    // Fly.io
    join(home, ".fly", "bin"),

    // Docker Desktop / Rancher Desktop
    join(home, ".docker", "bin"),
    join(home, ".rd", "bin"),
  ];
}

/**
 * Resolve the full shell PATH by merging:
 * 1. process.env.PATH (highest priority — what launched MicroClaw)
 * 2. Login shell PATH (captures .bashrc/.zshrc additions)
 * 3. Well-known macOS system paths (Homebrew, Apple tools, Xcode)
 * 4. NVM / fnm node version paths
 * 5. Common user-local tool paths (cargo, go, pyenv, etc.)
 *
 * Deduplicates via realpath resolution and returns a colon-joined string.
 */
function resolveShellPath(): string {
  const rawHome = process.env.HOME ?? "";
  const home = safeRealpath(rawHome);
  const userShell = process.env.SHELL || "/bin/sh";

  // 1. Current process PATH
  const processPath = process.env.PATH ?? "";

  // 2. Login shell PATH (catches .zprofile/.bash_profile additions)
  let loginPath = "";
  try {
    loginPath = execFileSync(userShell, ["-lc", "echo $PATH"], {
      timeout: 5000,
      encoding: "utf-8",
      env: { HOME: home, USER: process.env.USER, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
    }).trim();
  } catch {
    log.warn("Failed to resolve login shell PATH");
  }

  // 3–5. Discover additional paths
  const nvmPaths = resolveNvmPaths(home);
  const fnmPaths = resolveFnmPaths(home);
  const userPaths = resolveUserToolPaths(home);

  // Merge all sources, dedup by realpath
  const seenReal = new Set<string>();
  const merged: string[] = [];
  const allPaths = [
    ...processPath.split(":"),
    ...loginPath.split(":"),
    ...MACOS_WELL_KNOWN_PATHS,
    ...nvmPaths,
    ...fnmPaths,
    ...userPaths,
  ];
  for (const dir of allPaths) {
    if (!dir) continue;
    const real = safeRealpath(dir);
    if (!seenReal.has(real)) {
      seenReal.add(real);
      merged.push(real);
    }
  }
  return merged.join(":");
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
  /** Fully resolved shell PATH with macOS, NVM, Homebrew, and user tool paths */
  readonly shellPath: string;
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

  const shellPath = resolveShellPath();
  const shellDirs = shellPath.split(":");
  log.info(`Resolved shell PATH (${shellDirs.length} directories)`);
  for (const dir of shellDirs) {
    log.debug(`  PATH: ${dir}`);
  }

  return Object.freeze({ projectRoot, dataDir, skillsDir, cronStorePath, shellPath });
}
