import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hasBinary } from "../config.js";
import { isWithinDir } from "../install-skill.js";

export function extractZipToDir(params: {
  zipBuffer: Buffer;
  targetDir: string;
  skillsRoot: string;
  password: string;
}): void {
  const { zipBuffer, targetDir, skillsRoot, password } = params;

  if (!hasBinary("unzip")) {
    throw new Error("'unzip' binary not found on PATH — install it to use registry skills");
  }

  const tmpFile = path.join(skillsRoot, `.tmp-${randomUUID()}.zip`);

  try {
    writeFileSync(tmpFile, zipBuffer);

    execFileSync("unzip", ["-o", "-P", password, tmpFile, "-d", targetDir], { stdio: "pipe" });

    validateExtractedPaths(targetDir, skillsRoot);
    flattenSingleNestedDir(targetDir);
  } finally {
    if (existsSync(tmpFile)) {
      rmSync(tmpFile, { force: true });
    }
  }
}

function validateExtractedPaths(dir: string, skillsRoot: string): void {
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(entry.parentPath, entry.name);

    if (entry.isSymbolicLink()) {
      throw new Error(`Zip contains a symlink which is not allowed: ${entry.name}`);
    }

    if (!isWithinDir(skillsRoot, fullPath)) {
      throw new Error(`Zip contains a path that escapes the skills directory: ${entry.name}`);
    }
  }
}

function flattenSingleNestedDir(targetDir: string): void {
  const items = readdirSync(targetDir);
  if (items.length !== 1) {
    return;
  }
  const singleChild = path.join(targetDir, items[0]);
  if (!lstatSync(singleChild).isDirectory()) {
    return;
  }

  const nestedItems = readdirSync(singleChild);
  const tmpName = path.join(targetDir, `.flatten-${randomUUID()}`);
  renameSync(singleChild, tmpName);

  for (const item of nestedItems) {
    renameSync(path.join(tmpName, item), path.join(targetDir, item));
  }

  rmSync(tmpName, { recursive: true, force: true });
}
