import type { AgentTool, SkillDefinition, SkillToolFactory } from "./types.js";

export type SkillRecord = {
  definition: SkillDefinition;
  source: string;
};

export type SkillToolRegistration = {
  skillId: string;
  tool: AgentTool | SkillToolFactory;
};

export type SkillChannelRegistration = {
  skillId: string;
  plugin: unknown; // ChannelPlugin - avoid circular import
};

export type SkillRegistry = {
  skills: SkillRecord[];
  tools: SkillToolRegistration[];
  channels: SkillChannelRegistration[];
  diagnostics: SkillDiagnostic[];
};

export type SkillDiagnostic = {
  skillId: string;
  level: "info" | "warn" | "error";
  message: string;
};

export function createSkillRegistry(): SkillRegistry {
  return {
    skills: [],
    tools: [],
    channels: [],
    diagnostics: [],
  };
}
