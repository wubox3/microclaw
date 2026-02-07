import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runExec } from "./compat/exec.js";

export async function movePathToTrash(targetPath: string): Promise<string> {
  try {
    await runExec("trash", [targetPath], { timeout: 10_000 });
    return targetPath;
  } catch {
    const trashDir = path.join(os.homedir(), ".Trash");
    fs.mkdirSync(trashDir, { recursive: true });
    const base = path.basename(targetPath);
    const dest = path.join(trashDir, `${base}-${crypto.randomUUID()}`);
    try {
      fs.renameSync(targetPath, dest);
    } catch (renameErr: unknown) {
      if (renameErr && typeof renameErr === "object" && "code" in renameErr && renameErr.code === "EXDEV") {
        const stat = fs.lstatSync(targetPath);
        if (stat.isDirectory()) {
          fs.cpSync(targetPath, dest, { recursive: true });
          fs.rmSync(targetPath, { recursive: true, force: true });
        } else {
          fs.copyFileSync(targetPath, dest);
          fs.unlinkSync(targetPath);
        }
      } else {
        throw renameErr;
      }
    }
    return dest;
  }
}
