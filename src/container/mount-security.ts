/**
 * Mount Security Module for MicroClaw
 *
 * Validates additional mounts against an allowlist stored OUTSIDE the project root.
 * This prevents container agents from modifying security configuration.
 *
 * Allowlist location: ~/.config/microclaw/mount-allowlist.json
 */
import fs from "fs";
import os from "os";
import path from "path";

import { MOUNT_ALLOWLIST_PATH } from "./config.js";
import type { AdditionalMount, AllowedRoot, MountAllowlist, VolumeMount } from "./types.js";
import { createLogger } from "../logging.js";

const log = createLogger("mount-security");

let cachedAllowlist: MountAllowlist | null = null;
let allowlistLoadError: string | null = null;

const DEFAULT_BLOCKED_PATTERNS = [
  ".ssh",
  ".gnupg",
  ".gpg",
  ".aws",
  ".azure",
  ".gcloud",
  ".kube",
  ".docker",
  "credentials",
  ".env",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "id_rsa",
  "id_ed25519",
  "private_key",
  ".secret",
];

export function invalidateAllowlistCache(): void {
  cachedAllowlist = null;
  allowlistLoadError = null;
}

export function loadMountAllowlist(): MountAllowlist | null {
  if (cachedAllowlist !== null) {
    return cachedAllowlist;
  }

  // Don't permanently cache load errors — retry on next call
  // to handle transient failures (e.g., file temporarily unavailable)
  if (allowlistLoadError !== null) {
    allowlistLoadError = null;
  }

  try {
    if (!fs.existsSync(MOUNT_ALLOWLIST_PATH)) {
      allowlistLoadError = `Mount allowlist not found at ${MOUNT_ALLOWLIST_PATH}`;
      log.warn(
        `Mount allowlist not found at ${MOUNT_ALLOWLIST_PATH} - additional mounts will be BLOCKED`,
      );
      return null;
    }

    const content = fs.readFileSync(MOUNT_ALLOWLIST_PATH, "utf-8");
    const allowlist = JSON.parse(content) as MountAllowlist;

    if (!Array.isArray(allowlist.allowedRoots)) {
      throw new Error("allowedRoots must be an array");
    }
    if (!Array.isArray(allowlist.blockedPatterns)) {
      throw new Error("blockedPatterns must be an array");
    }
    if (typeof allowlist.nonMainReadOnly !== "boolean") {
      throw new Error("nonMainReadOnly must be a boolean");
    }

    const mergedBlocked = [
      ...new Set([...DEFAULT_BLOCKED_PATTERNS, ...allowlist.blockedPatterns]),
    ];

    cachedAllowlist = {
      ...allowlist,
      blockedPatterns: mergedBlocked,
    };

    log.info(
      `Mount allowlist loaded: ${allowlist.allowedRoots.length} roots, ${mergedBlocked.length} blocked patterns`,
    );

    return cachedAllowlist;
  } catch (err) {
    allowlistLoadError =
      err instanceof Error ? err.message : String(err);
    log.error(
      `Failed to load mount allowlist: ${allowlistLoadError} - additional mounts will be BLOCKED`,
    );
    return null;
  }
}

function expandPath(p: string): string {
  const homeDir = process.env.HOME || os.homedir();
  if (p.startsWith("~/")) {
    return path.join(homeDir, p.slice(2));
  }
  if (p === "~") {
    return homeDir;
  }
  return path.resolve(p);
}

function getRealPath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function matchesBlockedPattern(
  realPath: string,
  blockedPatterns: string[],
): string | null {
  const pathParts = realPath.split(path.sep);
  const fileName = pathParts[pathParts.length - 1] ?? "";

  for (const pattern of blockedPatterns) {
    // Exact match on any path component
    for (const part of pathParts) {
      if (part === pattern) {
        return pattern;
      }
    }
    // Also check if the filename starts with the pattern (e.g., ".env.local" matches ".env")
    if (fileName.startsWith(pattern)) {
      return pattern;
    }
  }

  return null;
}

function findAllowedRoot(
  realPath: string,
  allowedRoots: AllowedRoot[],
): AllowedRoot | null {
  for (const root of allowedRoots) {
    const expandedRoot = expandPath(root.path);
    const realRoot = getRealPath(expandedRoot);

    if (realRoot === null) {
      continue;
    }

    const relative = path.relative(realRoot, realPath);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return root;
    }
  }

  return null;
}

function isValidContainerPath(containerPath: string): boolean {
  if (!containerPath || containerPath.trim() === "") {
    return false;
  }
  if (containerPath.includes("\0")) {
    return false;
  }
  if (containerPath.startsWith("/")) {
    return false;
  }
  // Normalize to resolve sequences like foo/./../../bar -> ../bar
  const normalized = path.normalize(containerPath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return false;
  }
  return true;
}

export interface MountValidationResult {
  allowed: boolean;
  reason: string;
  realHostPath?: string;
  effectiveReadonly?: boolean;
}

export function validateMount(
  mount: AdditionalMount,
): MountValidationResult {
  const allowlist = loadMountAllowlist();

  if (allowlist === null) {
    return {
      allowed: false,
      reason: `No mount allowlist configured at ${MOUNT_ALLOWLIST_PATH}`,
    };
  }

  if (!isValidContainerPath(mount.containerPath)) {
    return {
      allowed: false,
      reason: `Invalid container path: "${mount.containerPath}" - must be relative, non-empty, and not contain ".."`,
    };
  }

  const expandedPath = expandPath(mount.hostPath);
  const realPath = getRealPath(expandedPath);

  if (realPath === null) {
    return {
      allowed: false,
      reason: `Host path does not exist: "${mount.hostPath}" (expanded: "${expandedPath}")`,
    };
  }

  const blockedMatch = matchesBlockedPattern(
    realPath,
    allowlist.blockedPatterns,
  );
  if (blockedMatch !== null) {
    return {
      allowed: false,
      reason: `Path matches blocked pattern "${blockedMatch}": "${realPath}"`,
    };
  }

  const allowedRoot = findAllowedRoot(realPath, allowlist.allowedRoots);
  if (allowedRoot === null) {
    return {
      allowed: false,
      reason: `Path "${realPath}" is not under any allowed root`,
    };
  }

  const requestedReadWrite = mount.readonly === false;
  let effectiveReadonly = true;

  if (requestedReadWrite && allowedRoot.allowReadWrite) {
    effectiveReadonly = false;
  }

  // Enforce nonMainReadOnly: non-main mounts are always read-only
  if (allowlist.nonMainReadOnly) {
    effectiveReadonly = true;
  }

  return {
    allowed: true,
    reason: `Allowed under root "${allowedRoot.path}"${allowedRoot.description ? ` (${allowedRoot.description})` : ""}`,
    realHostPath: realPath,
    effectiveReadonly,
  };
}

export function validateAdditionalMounts(
  mounts: AdditionalMount[],
): VolumeMount[] {
  const validated: VolumeMount[] = [];

  for (const mount of mounts) {
    const result = validateMount(mount);

    if (result.allowed) {
      validated.push({
        hostPath: result.realHostPath!,
        containerPath: `/workspace/extra/${mount.containerPath}`,
        readonly: result.effectiveReadonly!,
      });
    } else {
      log.warn(`Additional mount REJECTED: ${mount.hostPath} -> ${mount.containerPath}: ${result.reason}`);
    }
  }

  return validated;
}
