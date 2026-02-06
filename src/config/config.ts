import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { MicroClawConfig } from "./types.js";

const CONFIG_FILENAMES = [
  "microclaw.config.yaml",
  "microclaw.config.yml",
  "microclaw.config.json",
];

function validateConfig(value: unknown): MicroClawConfig {
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Config must be an object");
  }
  const obj = value as Record<string, unknown>;
  if (obj.web !== undefined && (typeof obj.web !== "object" || obj.web === null || Array.isArray(obj.web))) {
    throw new Error("Config 'web' must be an object");
  }
  if (obj.agent !== undefined && (typeof obj.agent !== "object" || obj.agent === null || Array.isArray(obj.agent))) {
    throw new Error("Config 'agent' must be an object");
  }
  if (obj.memory !== undefined && (typeof obj.memory !== "object" || obj.memory === null || Array.isArray(obj.memory))) {
    throw new Error("Config 'memory' must be an object");
  }
  if (obj.container !== undefined && (typeof obj.container !== "object" || obj.container === null || Array.isArray(obj.container))) {
    throw new Error("Config 'container' must be an object");
  }
  const web = obj.web as Record<string, unknown> | undefined;
  if (web?.port !== undefined && typeof web.port !== "number") {
    throw new Error("Config 'web.port' must be a number");
  }
  const agent = obj.agent as Record<string, unknown> | undefined;
  if (agent?.provider !== undefined && typeof agent.provider !== "string") {
    throw new Error("Config 'agent.provider' must be a string");
  }
  return value as MicroClawConfig;
}

export function loadConfig(dir?: string): MicroClawConfig {
  const baseDir = dir ?? process.cwd();

  for (const filename of CONFIG_FILENAMES) {
    const filepath = resolve(baseDir, filename);
    if (existsSync(filepath)) {
      let raw: string;
      try {
        raw = readFileSync(filepath, "utf-8");
      } catch (err) {
        throw new Error(`Failed to read config file ${filepath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      let parsed: unknown;
      try {
        parsed = filename.endsWith(".json")
          ? JSON.parse(raw)
          : (parseYaml(raw) ?? {});
      } catch (err) {
        throw new Error(`Failed to parse config file ${filepath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return validateConfig(parsed);
    }
  }

  return {};
}

export function resolveDataDir(config: MicroClawConfig): string {
  return config.memory?.dataDir ?? join(process.cwd(), ".microclaw");
}

export function resolvePort(config: MicroClawConfig): number {
  return config.web?.port ?? 3000;
}

export function resolveHost(config: MicroClawConfig): string {
  return config.web?.host ?? "localhost";
}
