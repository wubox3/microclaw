import { execFile } from "node:child_process";

export type RunExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export function runExec(
  command: string,
  args: string[],
  options?: { timeout?: number; cwd?: string },
): Promise<RunExecResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        timeout: options?.timeout ?? 30_000,
        cwd: options?.cwd,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err && !("code" in err)) {
          reject(err);
          return;
        }
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: child.exitCode,
        });
      },
    );
  });
}
