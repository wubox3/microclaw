import { resolve } from "node:path";
import type { MicroClawConfig } from "../config/types.js";
import type { SkillLogger, SkillApi, SkillDefinition, AgentTool, SkillToolFactory } from "./types.js";
import { createSkillRegistry, type SkillRegistry } from "./registry.js";
import { discoverSkills } from "./discovery.js";

function createSkillLogger(skillId: string): SkillLogger {
  const prefix = `[skill:${skillId}]`;
  return {
    info: (msg, ...args) => console.info(prefix, msg, ...args),
    warn: (msg, ...args) => console.warn(prefix, msg, ...args),
    error: (msg, ...args) => console.error(prefix, msg, ...args),
    debug: (msg, ...args) => console.debug(prefix, msg, ...args),
  };
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
    config,
    skillConfig,
    logger: createSkillLogger(skillId),
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

  const discovered = discoverSkills(skillsDir);

  for (const skill of discovered) {
    try {
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

      await definition.register(api);

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
