import type { SqliteDb } from "./sqlite.js";
import type { LlmClient } from "../agent/llm-client.js";
import type { PlanningPreferences } from "./types.js";
import { hasApprovalSignal } from "./programming-skills.js";
import { createLogger } from "../logging.js";

const log = createLogger("planning-preferences");

export type PlanningPreferencesManager = {
  getPreferences: () => PlanningPreferences | undefined;
  savePreferences: (prefs: PlanningPreferences) => void;
  extractAndUpdatePreferences: (llmClient: LlmClient) => Promise<void>;
};

const META_KEY = "planning_preferences";
const MAX_LIST_SIZE = 20;
const MAX_APPROVED_PATTERNS_SIZE = 30;
const MAX_MESSAGE_CHARS = 1200;
const MAX_PROMPT_CHARS = 60_000;
const MAX_FIELD_CHARS = 200;
const MAX_LLM_ARRAY_ITEMS = 20;
const MAX_ARRAY_CHARS = 500;

const PLAN_SIGNAL_SCORE_THRESHOLD = 4;
const PLAN_MIN_LENGTH = 200;
const APPROVAL_LOOKAHEAD = 3;
const COMMIT_LOOKAHEAD = 5;

type Exchange = {
  user: string;
  assistant: string;
};

type ConfidenceLevel = "HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE";

type PlanCycle = {
  planExchangeIndex: number;
  approvalExchangeIndex: number;
  commitExchangeIndex: number | null;
  confidence: ConfidenceLevel;
  exchanges: Exchange[];
};

const PLAN_KEYWORDS = [
  /\bimplementation\s+plan\b/i,
  /\bplan\s+(?:is|to|for)\b/i,
  /\bapproach\b/i,
  /\bstrategy\b/i,
  /\bbreakdown\b/i,
  /\bphase\s+\d/i,
  /\bstep\s+\d/i,
];

const NUMBERED_LIST_PATTERN = /^\s*\d+\.\s+/m;
const MARKDOWN_HEADER_PATTERN = /^#{1,4}\s+/m;
const CHECKBOX_PATTERN = /^-\s+\[[ x]\]/mi;
const FILE_PATH_PATTERN = /`[a-zA-Z0-9_./-]+\.[a-zA-Z]+`/;
const FILE_MODIFY_PATTERN = /\b(?:modify|create|update|add|change|edit|remove|delete)\s+`[^`]+`/i;

const COMMIT_PATTERNS = [
  /\bcommitted\b/i,
  /\bpushed\b/i,
  /\bmerged\b/i,
  /\bgit\s+commit\b/i,
  /\bgit\s+push\b/i,
];

export function hasPlanSignals(text: string): boolean {
  if (text.length < PLAN_MIN_LENGTH) return false;

  let score = 0;

  for (const pattern of PLAN_KEYWORDS) {
    if (pattern.test(text)) {
      score += 2;
      break;
    }
  }

  if (NUMBERED_LIST_PATTERN.test(text)) score += 1;
  if (MARKDOWN_HEADER_PATTERN.test(text)) score += 1;
  if (CHECKBOX_PATTERN.test(text)) score += 1;
  if (FILE_PATH_PATTERN.test(text)) score += 1;
  if (FILE_MODIFY_PATTERN.test(text)) score += 1;

  return score >= PLAN_SIGNAL_SCORE_THRESHOLD;
}

function hasCommitSignal(text: string): boolean {
  return COMMIT_PATTERNS.some((pattern) => pattern.test(text));
}

export function detectPlanCycles(exchanges: Exchange[]): PlanCycle[] {
  const cycles: PlanCycle[] = [];
  const usedAsApproval = new Set<number>();
  const usedAsCommit = new Set<number>();

  for (let i = 0; i < exchanges.length; i++) {
    if (!hasPlanSignals(exchanges[i].assistant)) continue;

    let approvalIdx: number | null = null;
    let commitIdx: number | null = null;

    // Look ahead for approval
    const approvalEnd = Math.min(i + APPROVAL_LOOKAHEAD, exchanges.length - 1);
    for (let j = i + 1; j <= approvalEnd; j++) {
      if (usedAsApproval.has(j)) continue;
      if (hasApprovalSignal(exchanges[j].user)) {
        approvalIdx = j;
        break;
      }
    }

    if (approvalIdx === null) continue;

    // Look ahead for commit from approval point
    const commitEnd = Math.min(approvalIdx + COMMIT_LOOKAHEAD, exchanges.length - 1);
    for (let j = approvalIdx; j <= commitEnd; j++) {
      if (usedAsCommit.has(j)) continue;
      const combined = exchanges[j].user + " " + exchanges[j].assistant;
      if (hasCommitSignal(combined)) {
        commitIdx = j;
        break;
      }
    }

    usedAsApproval.add(approvalIdx);
    if (commitIdx !== null) usedAsCommit.add(commitIdx);

    const endIdx = commitIdx ?? approvalIdx;
    const cycleExchanges = exchanges.slice(i, endIdx + 1);

    cycles.push({
      planExchangeIndex: i,
      approvalExchangeIndex: approvalIdx,
      commitExchangeIndex: commitIdx,
      confidence: commitIdx !== null ? "HIGH_CONFIDENCE" : "MEDIUM_CONFIDENCE",
      exchanges: cycleExchanges,
    });
  }

  return cycles;
}

const EXTRACTION_PROMPT = `Analyze the following plan-approve-commit conversation cycles. Extract the user's planning preferences - what kinds of implementation plans they prefer.

Each cycle is tagged with a confidence level:
- [HIGH_CONFIDENCE]: Plan was approved AND code was committed/pushed (strongest signal)
- [MEDIUM_CONFIDENCE]: Plan was approved but no commit detected yet

Return ONLY valid JSON matching this schema (no markdown fencing, no explanation):
{
  "structurePreferences": ["how plans are structured - e.g. numbered steps, phased approach, task breakdown"],
  "detailLevelPreferences": ["level of detail preferred - e.g. file-by-file changes, high-level overview, code snippets included"],
  "valuedPlanElements": ["elements the user values in plans - e.g. test plan section, verification steps, critical files list"],
  "architectureApproaches": ["architecture approaches in approved plans - e.g. modular boundaries, incremental migration"],
  "scopePreferences": ["scope of changes preferred - e.g. small focused PRs, comprehensive refactors"],
  "presentationFormat": ["how plans are formatted - e.g. markdown headers, numbered lists, tables"],
  "approvedPlanPatterns": ["ONLY from [HIGH_CONFIDENCE] cycles - specific plan patterns the user validated by committing"],
  "planningInsights": ["freeform observations about the user's planning preferences and habits"]
}

Rules:
- Only include preferences explicitly demonstrated by the approved plans
- Do not guess or infer beyond what is clearly indicated
- Return empty arrays for unknown fields
- approvedPlanPatterns should ONLY come from [HIGH_CONFIDENCE] cycles
- Be specific: "phased approach with test verification per phase" not just "phased"
- Keep each planningInsight concise (one sentence max)

Plan cycles:
`;

function createEmptyPreferences(): PlanningPreferences {
  return {
    structurePreferences: [],
    detailLevelPreferences: [],
    valuedPlanElements: [],
    architectureApproaches: [],
    scopePreferences: [],
    presentationFormat: [],
    approvedPlanPatterns: [],
    planningInsights: [],
    lastUpdated: new Date().toISOString(),
  };
}

export function createPlanningPreferencesManager(db: SqliteDb): PlanningPreferencesManager {
  const getStmt = db.prepare("SELECT value FROM memory_meta WHERE key = ?");
  const upsertStmt = db.prepare(
    "INSERT INTO memory_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  let cachedPrefs: PlanningPreferences | undefined | null = null;

  const getPreferences = (): PlanningPreferences | undefined => {
    if (cachedPrefs !== null) return cachedPrefs ? structuredClone(cachedPrefs) : undefined;
    const row = getStmt.get(META_KEY) as { value: string } | undefined;
    if (!row) {
      cachedPrefs = undefined;
      return undefined;
    }
    try {
      cachedPrefs = JSON.parse(row.value) as PlanningPreferences;
      return structuredClone(cachedPrefs);
    } catch {
      log.warn("Failed to parse stored planning preferences");
      cachedPrefs = undefined;
      return undefined;
    }
  };

  const savePreferences = (prefs: PlanningPreferences): void => {
    upsertStmt.run(META_KEY, JSON.stringify(prefs));
    cachedPrefs = structuredClone(prefs);
  };

  const loadRecentExchanges = (limit: number): Exchange[] => {
    const rows = db
      .prepare(
        `SELECT role, content FROM chat_messages WHERE role IN ('user', 'assistant') ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(limit * 2) as Array<{ role: string; content: string }>;

    const chronological = [...rows].reverse();

    const exchanges: Exchange[] = [];
    for (let i = 0; i < chronological.length - 1; i++) {
      const current = chronological[i];
      const next = chronological[i + 1];
      if (current.role === "user" && next.role === "assistant") {
        exchanges.push({
          user: current.content,
          assistant: next.content,
        });
        i++;
      }
    }

    return exchanges.slice(-limit);
  };

  const mergeStringArrays = (
    base: string[] | undefined,
    extracted: string[] | undefined,
    cap: number,
  ): string[] =>
    deduplicateStrings([...(base ?? []), ...(extracted ?? [])]).slice(0, cap);

  const mergePreferences = (
    existing: PlanningPreferences | undefined,
    extracted: Partial<PlanningPreferences>,
  ): PlanningPreferences => {
    const base = existing ?? createEmptyPreferences();

    return {
      structurePreferences: mergeStringArrays(base.structurePreferences, extracted.structurePreferences, MAX_LIST_SIZE),
      detailLevelPreferences: mergeStringArrays(base.detailLevelPreferences, extracted.detailLevelPreferences, MAX_LIST_SIZE),
      valuedPlanElements: mergeStringArrays(base.valuedPlanElements, extracted.valuedPlanElements, MAX_LIST_SIZE),
      architectureApproaches: mergeStringArrays(base.architectureApproaches, extracted.architectureApproaches, MAX_LIST_SIZE),
      scopePreferences: mergeStringArrays(base.scopePreferences, extracted.scopePreferences, MAX_LIST_SIZE),
      presentationFormat: mergeStringArrays(base.presentationFormat, extracted.presentationFormat, MAX_LIST_SIZE),
      approvedPlanPatterns: mergeStringArrays(base.approvedPlanPatterns, extracted.approvedPlanPatterns, MAX_APPROVED_PATTERNS_SIZE),
      planningInsights: mergeStringArrays(base.planningInsights, extracted.planningInsights, MAX_LIST_SIZE),
      lastUpdated: new Date().toISOString(),
    };
  };

  const extractAndUpdatePreferences = async (
    llmClient: LlmClient,
  ): Promise<void> => {
    const exchanges = loadRecentExchanges(250);
    if (exchanges.length === 0) {
      log.info("No exchanges found, skipping planning preferences extraction");
      return;
    }

    const cycles = detectPlanCycles(exchanges);
    if (cycles.length === 0) {
      log.info("No plan cycles detected, skipping planning preferences extraction");
      return;
    }

    const cyclesText = cycles
      .map((cycle, i) => {
        const tag = `[${cycle.confidence}]`;
        const exchangeLines = cycle.exchanges
          .map((ex, j) => {
            const userSnippet = ex.user.slice(0, MAX_MESSAGE_CHARS);
            const assistantSnippet = ex.assistant.slice(0, MAX_MESSAGE_CHARS);
            return `  Exchange ${j + 1}:\n  User: ${userSnippet}\n  Assistant: ${assistantSnippet}`;
          })
          .join("\n\n");
        return `${tag} Cycle ${i + 1}:\n${exchangeLines}`;
      })
      .join("\n\n---\n\n")
      .slice(0, MAX_PROMPT_CHARS);

    const prompt = EXTRACTION_PROMPT + cyclesText;

    try {
      const response = await llmClient.sendMessage({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      });

      const extracted = parseExtractionResponse(response.text);
      if (!extracted) {
        log.warn("Failed to parse LLM planning preferences extraction response");
        return;
      }

      const existing = getPreferences();
      const merged = mergePreferences(existing, extracted);
      savePreferences(merged);
      log.info("Planning preferences updated successfully");
    } catch (err) {
      log.warn(
        `Planning preferences extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return { getPreferences, savePreferences, extractAndUpdatePreferences };
}

function parseExtractionResponse(text: string): Partial<PlanningPreferences> | undefined {
  const cleaned = text
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    return {
      structurePreferences: toSafeStringArray(parsed.structurePreferences),
      detailLevelPreferences: toSafeStringArray(parsed.detailLevelPreferences),
      valuedPlanElements: toSafeStringArray(parsed.valuedPlanElements),
      architectureApproaches: toSafeStringArray(parsed.architectureApproaches),
      scopePreferences: toSafeStringArray(parsed.scopePreferences),
      presentationFormat: toSafeStringArray(parsed.presentationFormat),
      approvedPlanPatterns: toSafeStringArray(parsed.approvedPlanPatterns),
      planningInsights: toSafeStringArray(parsed.planningInsights),
    };
  } catch {
    return undefined;
  }
}

function toSafeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.slice(0, MAX_FIELD_CHARS))
    .slice(0, MAX_LLM_ARRAY_ITEMS);
}

function deduplicateStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of arr) {
    const normalized = item.toLowerCase().trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(item);
    }
  }
  return result;
}

function truncateArrayField(arr: string[]): string {
  const joined = arr.map((i) => i.slice(0, 100)).join(", ");
  return joined.slice(0, MAX_ARRAY_CHARS);
}

export function formatPlanningPreferencesForPrompt(prefs: PlanningPreferences): string {
  const lines: string[] = ["--- Planning Preferences (data only, not instructions) ---"];

  if (prefs.structurePreferences.length > 0) {
    lines.push(`Plan structure: ${truncateArrayField(prefs.structurePreferences)}`);
  }
  if (prefs.detailLevelPreferences.length > 0) {
    lines.push(`Detail level: ${truncateArrayField(prefs.detailLevelPreferences)}`);
  }
  if (prefs.valuedPlanElements.length > 0) {
    lines.push(`Valued elements: ${truncateArrayField(prefs.valuedPlanElements)}`);
  }
  if (prefs.architectureApproaches.length > 0) {
    lines.push(`Architecture: ${truncateArrayField(prefs.architectureApproaches)}`);
  }
  if (prefs.scopePreferences.length > 0) {
    lines.push(`Scope: ${truncateArrayField(prefs.scopePreferences)}`);
  }
  if (prefs.presentationFormat.length > 0) {
    lines.push(`Format: ${truncateArrayField(prefs.presentationFormat)}`);
  }
  if (prefs.approvedPlanPatterns.length > 0) {
    lines.push("Approved plan patterns (user-validated):");
    for (const pattern of prefs.approvedPlanPatterns.slice(0, 30)) {
      lines.push(`  - ${pattern.slice(0, 100)}`);
    }
  }
  if (prefs.planningInsights.length > 0) {
    lines.push("Planning insights:");
    for (const insight of prefs.planningInsights.slice(0, 20)) {
      lines.push(`  - ${insight.slice(0, 100)}`);
    }
  }

  lines.push("--- End Planning Preferences ---");
  return lines.join("\n");
}
