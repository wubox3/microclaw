import type { MicroClawConfig } from "../config/types.js";
import type { MemorySearchResult, UserProfile, ProgrammingSkills, PlanningPreferences, ProgrammingPlanning, EventPlanning } from "../memory/types.js";
import { formatProfileForPrompt } from "../memory/user-profile.js";
import { formatProgrammingSkillsForPrompt } from "../memory/gcc-programming-skills.js";
import { formatProgrammingPlanningForPrompt } from "../memory/gcc-programming-planning.js";
import { formatEventPlanningForPrompt } from "../memory/gcc-event-planning.js";

const BASE_SYSTEM_PROMPT = `You are MicroClaw, a helpful AI assistant that can communicate across multiple messaging channels.

You have access to a memory system that stores relevant context from past conversations and files.
When memory results are provided, use them to give more informed and contextual responses.

Be concise, helpful, and friendly. Format responses appropriately for the channel you're communicating through.`;

const CANVAS_INSTRUCTIONS = `
You have a canvas tool that lets you display interactive visual content in a side panel.

To use the canvas:
1. Call canvas with action "present" to show the panel
2. Call canvas with action "a2ui_push" and a "messages" array to render A2UI components
3. Users can interact with components (buttons, inputs, etc.) and you'll receive their actions

Available A2UI components: text, button, card, image, list, tabs, text-field, checkbox, slider, divider, row, column, modal.

When a user asks you to show something visual, create a UI, or display interactive content, use the canvas tool. Always call "present" first, then "a2ui_push" with your component tree.

When you receive a canvas action from the user (e.g. button click), respond appropriately and update the canvas if needed.`;

export function buildSystemPrompt(params: {
  config: MicroClawConfig;
  memoryResults?: MemorySearchResult[];
  channelId?: string;
  canvasEnabled?: boolean;
  userProfile?: UserProfile;
  programmingSkills?: ProgrammingSkills;
  planningPreferences?: PlanningPreferences;
  programmingPlanning?: ProgrammingPlanning;
  eventPlanning?: EventPlanning;
}): string {
  const parts: string[] = [];

  // Base prompt or custom prompt
  parts.push(params.config.agent?.systemPrompt ?? BASE_SYSTEM_PROMPT);

  // User profile (injected early, before memory results)
  if (params.userProfile) {
    parts.push("\n" + formatProfileForPrompt(params.userProfile));
  }

  // Programming skills (injected after user profile)
  if (params.programmingSkills) {
    parts.push("\n" + formatProgrammingSkillsForPrompt(params.programmingSkills));
  }

  // Programming planning preferences (injected after programming skills)
  if (params.programmingPlanning) {
    parts.push("\n" + formatProgrammingPlanningForPrompt(params.programmingPlanning));
  }

  // Event planning preferences
  if (params.eventPlanning) {
    parts.push("\n" + formatEventPlanningForPrompt(params.eventPlanning));
  }

  // Canvas instructions
  if (params.canvasEnabled) {
    parts.push(CANVAS_INSTRUCTIONS);
  }

  // Channel context
  if (params.channelId) {
    parts.push(`\nCurrent channel: ${params.channelId}`);
    if (params.channelId === "x") {
      parts.push("You are in the X (Twitter) channel. Use the bird tool to read tweets, search, view timelines, post, and engage on X/Twitter on behalf of the user. Proactively use the bird tool for any X/Twitter-related requests.");
    }
  }

  // Memory context
  if (params.memoryResults && params.memoryResults.length > 0) {
    parts.push("\n--- Relevant Memory Context ---");
    for (const result of params.memoryResults.slice(0, 5)) {
      parts.push(`[${result.filePath}:${result.startLine}] ${result.snippet}`);
    }
    parts.push("--- End Memory Context ---");
  }

  return parts.join("\n");
}
