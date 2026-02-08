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
  if (obj.voice !== undefined && (typeof obj.voice !== "object" || obj.voice === null || Array.isArray(obj.voice))) {
    throw new Error("Config 'voice' must be an object");
  }
  if (obj.browser !== undefined && (typeof obj.browser !== "object" || obj.browser === null || Array.isArray(obj.browser))) {
    throw new Error("Config 'browser' must be an object");
  }
  if (obj.cron !== undefined && (typeof obj.cron !== "object" || obj.cron === null || Array.isArray(obj.cron))) {
    throw new Error("Config 'cron' must be an object");
  }
  if (obj.skills !== undefined && (typeof obj.skills !== "object" || obj.skills === null || Array.isArray(obj.skills))) {
    throw new Error("Config 'skills' must be an object");
  }
  const web = obj.web as Record<string, unknown> | undefined;
  if (web?.port !== undefined && typeof web.port !== "number") {
    throw new Error("Config 'web.port' must be a number");
  }
  if (typeof web?.port === "number") {
    const p = web.port;
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      throw new Error("web.port must be an integer between 1 and 65535");
    }
  }
  const agent = obj.agent as Record<string, unknown> | undefined;
  if (agent?.provider !== undefined && typeof agent.provider !== "string") {
    throw new Error("Config 'agent.provider' must be a string");
  }
  if (typeof obj.agent === "object" && obj.agent !== null) {
    const agentObj = obj.agent as Record<string, unknown>;
    if ("maxTokens" in agentObj && (typeof agentObj.maxTokens !== "number" || agentObj.maxTokens < 1)) {
      throw new Error("agent.maxTokens must be a positive number");
    }
    if ("temperature" in agentObj && (typeof agentObj.temperature !== "number" || agentObj.temperature < 0 || agentObj.temperature > 2)) {
      throw new Error("agent.temperature must be between 0 and 2");
    }
  }
  if (typeof obj.container === "object" && obj.container !== null) {
    const containerObj = obj.container as Record<string, unknown>;
    if ("timeout" in containerObj && (typeof containerObj.timeout !== "number" || containerObj.timeout < 1000)) {
      throw new Error("container.timeout must be at least 1000ms");
    }
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
