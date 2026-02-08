import { resolve } from "node:path";
import type { MicroClawConfig } from "../config/types.js";
import type { SkillLogger, SkillApi, SkillDefinition, AgentTool, SkillToolFactory } from "./types.js";
import { createSkillRegistry, type SkillRegistry } from "./registry.js";
import { discoverSkills } from "./discovery.js";
import { createLogger } from "../logging.js";

function createSkillLogger(skillId: string): SkillLogger {
  const log = createLogger(`skill:${skillId}`);
  return {
    info: (msg, ...args) => log.info(msg, ...args),
    warn: (msg, ...args) => log.warn(msg, ...args),
    error: (msg, ...args) => log.error(msg, ...args),
    debug: (msg, ...args) => log.debug(msg, ...args),
  };
}

function redactSensitiveConfig(config: MicroClawConfig): MicroClawConfig {
  let clone: MicroClawConfig;
  try {
    clone = structuredClone(config);
  } catch {
    try {
      clone = JSON.parse(JSON.stringify(config));
    } catch {
      return config;
    }
  }
  // Strip API keys and tokens to prevent skill plugins from exfiltrating credentials
  // Note: walk() mutates the clone
  const walk = (obj: Record<string, unknown>, depth = 0) => {
    if (depth > 10 || !obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      const lower = key.toLowerCase();
      const SENSITIVE_PATTERNS = [/(?:^|_|-)(api[_-]?key|secret[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?key)(?:$|_|-)/i, /(?:^|_|-)(token|secret|password|credential|auth[_-]?secret)(?:$|_|-)/i];
      if (SENSITIVE_PATTERNS.some((p) => p.test(key))) {
        obj[key] = "[REDACTED]";
      } else if (typeof obj[key] === "object" && obj[key] !== null) {
        walk(obj[key] as Record<string, unknown>, depth + 1);
      }
    }
  };
  walk(clone as unknown as Record<string, unknown>);
  return clone;
}

const SKILL_REGISTER_TIMEOUT_MS = 10_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function createSkillApi(
  skillId: string,
  config: MicroClawConfig,
  registry: SkillRegistry,
  skillConfig?: Record<string, unknown>,
): SkillApi {
  return {
    id: skillId,
    name: skillId,
    config: redactSensitiveConfig(config),
    skillConfig,
    logger: createSkillLogger(skillId),
    // Intentional mutation: registry arrays are internal and not exposed to
    // external consumers. Push is acceptable for an internal append-only registry.
    registerTool: (tool: AgentTool | SkillToolFactory) => {
      registry.tools.push({ skillId, tool });
    },
    registerChannel: (channel: unknown) => {
      registry.channels.push({ skillId, plugin: channel });
    },
  };
}

export async function loadSkills(params: {
  config: MicroClawConfig;
  skillsDir?: string;
}): Promise<SkillRegistry> {
  const registry = createSkillRegistry();
  const skillsDir = params.skillsDir ?? resolve(process.cwd(), "skills");

  const discovered = await discoverSkills(skillsDir);

  for (const skill of discovered) {
    try {
      // WARNING: Skills are loaded via dynamic import without sandboxing.
      // Only load skills from trusted sources. A malicious skill can access
      // the full Node.js runtime, file system, and network.
      const mod = await import(skill.entryPoint);
      const definition: SkillDefinition = mod.default ?? mod;

      if (!definition.register) {
        registry.diagnostics.push({
          skillId: skill.manifest.id,
          level: "warn",
          message: `Skill ${skill.manifest.id} has no register function`,
        });
        continue;
      }

      const api = createSkillApi(
        skill.manifest.id,
        params.config,
        registry,
        undefined,
      );

      await withTimeout(
        Promise.resolve(definition.register(api)),
        SKILL_REGISTER_TIMEOUT_MS,
        `Skill "${skill.manifest.id}" register`,
      );

      registry.skills.push({
        definition: {
          ...definition,
          id: skill.manifest.id,
          name: skill.manifest.name,
        },
        source: skill.dir,
      });

      registry.diagnostics.push({
        skillId: skill.manifest.id,
        level: "info",
        message: `Loaded skill: ${skill.manifest.name}`,
      });
    } catch (err) {
      registry.diagnostics.push({
        skillId: skill.manifest.id,
        level: "error",
        message: `Failed to load skill ${skill.manifest.id}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return registry;
}
