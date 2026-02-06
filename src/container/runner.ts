/**
 * Container Runner for MicroClaw
 * Spawns agent execution in Docker containers and handles I/O
 */
import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";

import { randomBytes } from "node:crypto";
import {
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  OUTPUT_END_MARKER,
  OUTPUT_START_MARKER,
} from "./config.js";
import { validateAdditionalMounts } from "./mount-security.js";
import type { ContainerConfig, ContainerInput, ContainerOutput, VolumeMount } from "./types.js";
import { createLogger } from "../logging.js";

const log = createLogger("container");

function sanitizeChannelId(channelId: string): string {
  return channelId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function buildVolumeMounts(
  channelId: string,
  config?: ContainerConfig,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const projectRoot = process.cwd();

  const safeChannelId = sanitizeChannelId(channelId);

  // Workspace: per-channel working directory
  const workspaceDir = path.join(DATA_DIR, "workspace", safeChannelId);
  fs.mkdirSync(workspaceDir, { recursive: true });
  mounts.push({
    hostPath: workspaceDir,
    containerPath: "/workspace/group",
    readonly: false,
  });

  // Sessions: per-channel Claude session state
  const sessionsDir = path.join(DATA_DIR, "sessions", safeChannelId, ".claude");
  fs.mkdirSync(sessionsDir, { recursive: true });
  mounts.push({
    hostPath: sessionsDir,
    containerPath: "/home/node/.claude",
    readonly: false,
  });

  // IPC: per-channel IPC namespace
  const ipcDir = path.join(DATA_DIR, "ipc", safeChannelId);
  fs.mkdirSync(path.join(ipcDir, "messages"), { recursive: true });
  fs.mkdirSync(path.join(ipcDir, "tasks"), { recursive: true });
  mounts.push({
    hostPath: ipcDir,
    containerPath: "/workspace/ipc",
    readonly: false,
  });

  // Environment: filtered auth vars only (read-only)
  const envDir = path.join(DATA_DIR, "env");
  const envFile = path.join(envDir, "env");
  if (fs.existsSync(envFile)) {
    mounts.push({
      hostPath: envDir,
      containerPath: "/workspace/env-dir",
      readonly: true,
    });
  }

  // Additional mounts validated against external allowlist
  if (config?.additionalMounts) {
    const validated = validateAdditionalMounts(config.additionalMounts);
    mounts.push(...validated);
  }

  return mounts;
}

function buildDockerArgs(
  mounts: VolumeMount[],
  containerName: string,
  image: string,
): string[] {
  const args: string[] = [
    "run",
    "-i",
    "--rm",
    "--name", containerName,
    // Security hardening
    "--cap-drop", "ALL",
    "--no-new-privileges",
    "--pids-limit", "256",
    "--memory", "1g",
    "--cpus", "2",
  ];

  for (const mount of mounts) {
    if (mount.readonly) {
      args.push(
        "--mount",
        `type=bind,source=${mount.hostPath},target=${mount.containerPath},readonly`,
      );
    } else {
      args.push("-v", `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  args.push(image);

  return args;
}

export async function runContainerAgent(
  input: ContainerInput,
  config?: ContainerConfig,
): Promise<ContainerOutput> {
  const startTime = Date.now();
  const image = config?.image ?? CONTAINER_IMAGE;
  const timeout = config?.timeout ?? CONTAINER_TIMEOUT;

  const mounts = buildVolumeMounts(input.channelId, config);
  const safeName = sanitizeChannelId(input.channelId);
  const containerName = `microclaw-${safeName}-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const dockerArgs = buildDockerArgs(mounts, containerName, image);

  log.info(
    `Spawning container: ${containerName} (${mounts.length} mounts, timeout: ${timeout}ms)`,
  );

  const logsDir = path.join(DATA_DIR, "logs");
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const container = spawn("docker", dockerArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;

    container.stdin.write(JSON.stringify(input));
    container.stdin.end();

    container.stdout.on("data", (data: Buffer) => {
      if (stdoutTruncated) return;
      const chunk = data.toString();
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
      if (chunk.length > remaining) {
        stdout += chunk.slice(0, remaining);
        stdoutTruncated = true;
        log.warn(`Container stdout truncated at ${stdout.length} bytes`);
      } else {
        stdout += chunk;
      }
    });

    container.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      const lines = chunk.trim().split("\n");
      for (const line of lines) {
        if (line) log.debug(`[${safeName}] ${line}`);
      }
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
      } else {
        stderr += chunk;
      }
    });

    let timedOut = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      log.error(`Container timeout: ${containerName}`);
      execFile("docker", ["stop", containerName], { timeout: 15000 }, (err) => {
        if (err) {
          log.warn(`Graceful stop failed for ${containerName}, force killing`);
          container.kill("SIGKILL");
        }
      });
    }, timeout);

    container.on("close", (code) => {
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;

      // Write log file
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const logFile = path.join(logsDir, `container-${timestamp}.log`);
      const logLines = [
        `=== Container Run Log${timedOut ? " (TIMEOUT)" : ""} ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Container: ${containerName}`,
        `Channel: ${input.channelId}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        `Stdout Truncated: ${stdoutTruncated}`,
        `Stderr Truncated: ${stderrTruncated}`,
        ``,
        `=== Input Summary ===`,
        `Prompt length: ${input.prompt.length} chars`,
        `Session ID: ${input.sessionId || "new"}`,
        ``,
        `=== Mounts ===`,
        mounts
          .map((m) => `${m.containerPath}${m.readonly ? " (ro)" : ""}`)
          .join("\n"),
        ``,
      ];

      if (code !== 0) {
        logLines.push(
          `=== Stderr (last 500 chars) ===`,
          stderr.slice(-500),
          ``,
        );
      }

      fs.writeFileSync(logFile, logLines.join("\n"));

      if (timedOut) {
        resolve({
          status: "error",
          result: null,
          error: `Container timed out after ${timeout}ms`,
        });
        return;
      }

      if (code !== 0) {
        log.error(
          `Container exited with code ${code} (${duration}ms)`,
        );
        resolve({
          status: "error",
          result: null,
          error: `Container exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      try {
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          const lines = stdout.trim().split("\n");
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);

        log.info(
          `Container completed: ${output.status} (${duration}ms)`,
        );

        resolve(output);
      } catch (err) {
        log.error(
          `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`,
        );
        resolve({
          status: "error",
          result: null,
          error: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    container.on("error", (err) => {
      clearTimeout(timeoutHandle);
      log.error(`Container spawn error: ${err.message}`);
      resolve({
        status: "error",
        result: null,
        error: `Container spawn error: ${err.message}`,
      });
    });
  });
}
