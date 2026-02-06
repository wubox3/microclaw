// Public SDK for skill authors
export type {
  SkillDefinition,
  SkillApi,
  SkillLogger,
  AgentTool,
  AgentToolResult,
  SkillToolFactory,
  SkillToolContext,
  SkillConfigSchema,
} from "../skills/types.js";

export function defineSkill(definition: import("../skills/types.js").SkillDefinition): import("../skills/types.js").SkillDefinition {
  return definition;
}
