import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { extractZipToDir } from "./extract.js";

const TMP_ROOT = path.join(import.meta.dirname, "__test_extract_tmp__");
const SKILLS_ROOT = path.join(TMP_ROOT, "skills");
const TARGET_DIR = path.join(SKILLS_ROOT, "test-skill");

beforeEach(() => {
  mkdirSync(SKILLS_ROOT, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

const TEST_ZIP_PASSWORD = "test-secret-pw";

function createSimpleZip(): Buffer {
  const tmpDir = path.join(TMP_ROOT, "zip-src");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(path.join(tmpDir, "SKILL.md"), "---\nname: test\n---\nHello");
  writeFileSync(path.join(tmpDir, "README.md"), "# Test");

  const zipPath = path.join(TMP_ROOT, "test.zip");
  execFileSync("zip", ["-r", "-P", TEST_ZIP_PASSWORD, zipPath, "."], { cwd: tmpDir, stdio: "pipe" });
  return readFileSync(zipPath);
}

function createNestedZip(): Buffer {
  const tmpDir = path.join(TMP_ROOT, "zip-nested-src");
  const innerDir = path.join(tmpDir, "my-skill-v1.0.0");
  mkdirSync(innerDir, { recursive: true });
  writeFileSync(path.join(innerDir, "SKILL.md"), "---\nname: nested\n---\nNested skill");

  const zipPath = path.join(TMP_ROOT, "nested.zip");
  execFileSync("zip", ["-r", "-P", TEST_ZIP_PASSWORD, zipPath, "."], { cwd: tmpDir, stdio: "pipe" });
  return readFileSync(zipPath);
}

describe("extractZipToDir", () => {
  it("extracts zip contents to target directory", () => {
    const zipBuffer = createSimpleZip();
    extractZipToDir({ zipBuffer, targetDir: TARGET_DIR, skillsRoot: SKILLS_ROOT, password: TEST_ZIP_PASSWORD });

    expect(existsSync(path.join(TARGET_DIR, "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(TARGET_DIR, "README.md"))).toBe(true);
  });

  it("flattens single nested directory", () => {
    const zipBuffer = createNestedZip();
    extractZipToDir({ zipBuffer, targetDir: TARGET_DIR, skillsRoot: SKILLS_ROOT, password: TEST_ZIP_PASSWORD });

    expect(existsSync(path.join(TARGET_DIR, "SKILL.md"))).toBe(true);
    const items = readdirSync(TARGET_DIR);
    expect(items).not.toContain("my-skill-v1.0.0");
  });

  it("cleans up temp zip file after extraction", () => {
    const zipBuffer = createSimpleZip();
    extractZipToDir({ zipBuffer, targetDir: TARGET_DIR, skillsRoot: SKILLS_ROOT, password: TEST_ZIP_PASSWORD });

    const tmpFiles = readdirSync(SKILLS_ROOT).filter((f) => f.startsWith(".tmp-"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("cleans up temp file even on extraction error", () => {
    const badZip = Buffer.from("not a zip file");
    expect(() =>
      extractZipToDir({ zipBuffer: badZip, targetDir: TARGET_DIR, skillsRoot: SKILLS_ROOT, password: TEST_ZIP_PASSWORD }),
    ).toThrow();

    const tmpFiles = readdirSync(SKILLS_ROOT).filter((f) => f.startsWith(".tmp-"));
    expect(tmpFiles).toHaveLength(0);
  });
});
