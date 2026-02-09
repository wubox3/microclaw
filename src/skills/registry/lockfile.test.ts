import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  readLockFile,
  writeLockFile,
  addLockEntry,
  removeLockEntry,
  getLockEntry,
  lockFilePath,
} from "./lockfile.js";
import type { LockEntry, LockFile } from "./types.js";

const TMP_ROOT = path.join(import.meta.dirname, "__test_lockfile_tmp__");

function makeLockFile(): LockFile {
  return { version: 1, skills: {} };
}

function makeEntry(slug: string, version = "1.0.0"): LockEntry {
  return {
    slug,
    version,
    installedAt: "2026-01-01T00:00:00Z",
    registryUrl: "https://www.eclaw.ai",
  };
}

beforeEach(() => {
  mkdirSync(TMP_ROOT, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("readLockFile", () => {
  it("returns empty lock file when file does not exist", () => {
    const result = readLockFile(TMP_ROOT);
    expect(result).toEqual({ version: 1, skills: {} });
  });

  it("parses valid lock file", () => {
    const lock: LockFile = {
      version: 1,
      skills: { calendar: makeEntry("calendar") },
    };
    mkdirSync(path.join(TMP_ROOT, ".eclaw"), { recursive: true });
    writeFileSync(lockFilePath(TMP_ROOT), JSON.stringify(lock), "utf-8");

    const result = readLockFile(TMP_ROOT);
    expect(result.version).toBe(1);
    expect(result.skills.calendar.slug).toBe("calendar");
  });

  it("returns empty lock file on invalid JSON", () => {
    mkdirSync(path.join(TMP_ROOT, ".eclaw"), { recursive: true });
    writeFileSync(lockFilePath(TMP_ROOT), "not-json", "utf-8");
    const result = readLockFile(TMP_ROOT);
    expect(result).toEqual({ version: 1, skills: {} });
  });
});

describe("writeLockFile", () => {
  it("creates .eclaw directory and writes sorted JSON", () => {
    const lock: LockFile = {
      version: 1,
      skills: {
        zebra: makeEntry("zebra"),
        alpha: makeEntry("alpha"),
      },
    };
    writeLockFile(TMP_ROOT, lock);

    expect(existsSync(lockFilePath(TMP_ROOT))).toBe(true);
    const raw = readFileSync(lockFilePath(TMP_ROOT), "utf-8");
    const parsed = JSON.parse(raw);
    const keys = Object.keys(parsed.skills);
    expect(keys).toEqual(["alpha", "zebra"]);
  });
});

describe("addLockEntry", () => {
  it("returns new object without mutating original", () => {
    const original = makeLockFile();
    const entry = makeEntry("calendar");
    const updated = addLockEntry(original, entry);

    expect(updated.skills.calendar).toEqual(entry);
    expect(original.skills.calendar).toBeUndefined();
    expect(updated).not.toBe(original);
  });
});

describe("removeLockEntry", () => {
  it("returns new object without the removed entry", () => {
    const lock = addLockEntry(makeLockFile(), makeEntry("calendar"));
    const updated = removeLockEntry(lock, "calendar");

    expect(updated.skills.calendar).toBeUndefined();
    expect(lock.skills.calendar).toBeDefined();
    expect(updated).not.toBe(lock);
  });

  it("handles removing non-existent entry gracefully", () => {
    const lock = makeLockFile();
    const updated = removeLockEntry(lock, "nope");
    expect(updated).toEqual({ version: 1, skills: {} });
  });
});

describe("getLockEntry", () => {
  it("returns entry when present", () => {
    const entry = makeEntry("calendar", "2.0.0");
    const lock = addLockEntry(makeLockFile(), entry);
    expect(getLockEntry(lock, "calendar")).toEqual(entry);
  });

  it("returns undefined when absent", () => {
    expect(getLockEntry(makeLockFile(), "nope")).toBeUndefined();
  });
});
