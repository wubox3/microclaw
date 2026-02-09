import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LockFileSchema, type LockEntry, type LockFile } from "./types.js";

const LOCK_DIR = ".eclaw";
const LOCK_FILE = "lock.json";

function emptyLockFile(): LockFile {
  return { version: 1, skills: {} };
}

export function lockFilePath(projectRoot: string): string {
  return path.join(projectRoot, LOCK_DIR, LOCK_FILE);
}

export function readLockFile(projectRoot: string): LockFile {
  const filePath = lockFilePath(projectRoot);
  if (!existsSync(filePath)) {
    return emptyLockFile();
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return LockFileSchema.parse(parsed);
  } catch {
    return emptyLockFile();
  }
}

export function writeLockFile(projectRoot: string, lockFile: LockFile): void {
  const dir = path.join(projectRoot, LOCK_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const sorted = Object.keys(lockFile.skills)
    .sort()
    .reduce<Record<string, LockEntry>>((acc, key) => {
      acc[key] = lockFile.skills[key];
      return acc;
    }, {});
  const output: LockFile = { version: 1, skills: sorted };
  writeFileSync(lockFilePath(projectRoot), JSON.stringify(output, null, 2) + "\n", "utf-8");
}

export function addLockEntry(lockFile: LockFile, entry: LockEntry): LockFile {
  return {
    ...lockFile,
    skills: {
      ...lockFile.skills,
      [entry.slug]: entry,
    },
  };
}

export function removeLockEntry(lockFile: LockFile, slug: string): LockFile {
  const { [slug]: _removed, ...remaining } = lockFile.skills;
  return {
    ...lockFile,
    skills: remaining,
  };
}

export function getLockEntry(lockFile: LockFile, slug: string): LockEntry | undefined {
  return lockFile.skills[slug];
}
