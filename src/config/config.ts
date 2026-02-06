import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { MicroClawConfig } from "./types.js";

const CONFIG_FILENAMES = [
  "microclaw.config.yaml",
  "microclaw.config.yml",
  "microclaw.config.json",
];

export function loadConfig(dir?: string): MicroClawConfig {
  const baseDir = dir ?? process.cwd();

  for (const filename of CONFIG_FILENAMES) {
    const filepath = resolve(baseDir, filename);
    if (existsSync(filepath)) {
      const raw = readFileSync(filepath, "utf-8");
      if (filename.endsWith(".json")) {
        return JSON.parse(raw) as MicroClawConfig;
      }
      return (parseYaml(raw) ?? {}) as MicroClawConfig;
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
