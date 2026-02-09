import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  createPlanningPreferencesManager,
  formatPlanningPreferencesForPrompt,
  hasPlanSignals,
  detectPlanCycles,
} from "./planning-preferences.js";
import { MEMORY_SCHEMA, FTS_SYNC_TRIGGERS, CHAT_SCHEMA } from "./memory-schema.js";
import type { PlanningPreferences } from "./types.js";
import type { LlmClient } from "../agent/llm-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(MEMORY_SCHEMA);
  db.exec(FTS_SYNC_TRIGGERS);
  db.exec(CHAT_SCHEMA);
  return db;
}

function seedExchanges(
  db: DatabaseSync,
  exchanges: Array<{ user: string; assistant: string }>,
): void {
  const stmt = db.prepare(
    "INSERT INTO chat_messages (channel_id, role, content, timestamp) VALUES ('web', ?, ?, ?)",
  );
  let ts = 1000;
  for (const ex of exchanges) {
    stmt.run("user", ex.user, ts++);
    stmt.run("assistant", ex.assistant, ts++);
  }
}

function createMockLlmClient(responseText: string): LlmClient {
  return {
    sendMessage: vi.fn().mockResolvedValue({ text: responseText }),
    streamMessage: vi.fn(),
  };
}

function minimalPrefs(overrides: Partial<PlanningPreferences> = {}): PlanningPreferences {
  return {
    structurePreferences: [],
    detailLevelPreferences: [],
    valuedPlanElements: [],
    architectureApproaches: [],
    scopePreferences: [],
    presentationFormat: [],
    approvedPlanPatterns: [],
    planningInsights: [],
    lastUpdated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePlanText(extra = ""): string {
  return `## Implementation Plan

Here's my approach for this feature:

1. First, we'll modify \`src/auth/login.ts\` to add the new handler
2. Then update \`src/routes/index.ts\` to register the route
3. Add validation with zod schema

### Phase 1: Authentication
- [ ] Create the auth middleware
- [ ] Add token verification

### Phase 2: Routes
- [ ] Register new endpoints
- [ ] Add rate limiting

This implementation plan covers the core changes needed.${extra}`;
}

// ---------------------------------------------------------------------------
// hasPlanSignals
// ---------------------------------------------------------------------------

describe("hasPlanSignals", () => {
  it("detects numbered step lists with plan keywords and file paths", () => {
    expect(hasPlanSignals(makePlanText())).toBe(true);
  });

  it("detects markdown headers with implementation plan keyword", () => {
    const text = `## Implementation Plan

Here is the approach for adding the new feature to the codebase.

1. Modify \`src/components/App.tsx\` to add the new component
2. Create \`src/utils/helpers.ts\` for utility functions
3. Update \`src/index.ts\` to wire everything together

This covers all the changes needed for the feature.`;
    expect(hasPlanSignals(text)).toBe(true);
  });

  it("returns false for short casual mentions of plan", () => {
    expect(hasPlanSignals("Let's plan to meet tomorrow")).toBe(false);
  });

  it("returns false for text shorter than minimum length", () => {
    expect(hasPlanSignals("## Plan\n1. Do thing\n2. Do other")).toBe(false);
  });

  it("returns false for code-only responses without plan signals", () => {
    const code = "```typescript\n" + "const x = 1;\n".repeat(30) + "```\n" +
      "Here's the implementation of the sorting algorithm. It uses a divide and conquer approach to efficiently sort the array in O(n log n) time complexity.";
    expect(hasPlanSignals(code)).toBe(false);
  });

  it("detects checkbox lists with file modification mentions", () => {
    const text = `Here's the strategy for the refactor:

We need to update several files to complete this breakdown of the feature.

- [x] Update \`src/config/settings.ts\` to add new config options
- [ ] Modify \`src/server/routes.ts\` to handle new endpoints
- [ ] Create \`src/middleware/auth.ts\` for authentication

The approach involves an incremental migration to the new architecture.
Each step builds on the previous one.`;
    expect(hasPlanSignals(text)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectPlanCycles
// ---------------------------------------------------------------------------

describe("detectPlanCycles", () => {
  it("detects plan->approval->commit (high confidence)", () => {
    const exchanges = [
      { user: "Can you plan the auth feature?", assistant: makePlanText() },
      { user: "LGTM, let's go with that", assistant: "Great, implementing now..." },
      { user: "I committed the changes", assistant: "Excellent!" },
    ];

    const cycles = detectPlanCycles(exchanges);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].confidence).toBe("HIGH_CONFIDENCE");
    expect(cycles[0].planExchangeIndex).toBe(0);
    expect(cycles[0].approvalExchangeIndex).toBe(1);
    expect(cycles[0].commitExchangeIndex).toBe(2);
  });

  it("detects plan->approval without commit (medium confidence)", () => {
    const exchanges = [
      { user: "Plan the database migration", assistant: makePlanText() },
      { user: "Looks good to me", assistant: "I'll start working on it." },
      { user: "How's the weather?", assistant: "I'm not sure about that." },
    ];

    const cycles = detectPlanCycles(exchanges);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].confidence).toBe("MEDIUM_CONFIDENCE");
    expect(cycles[0].commitExchangeIndex).toBeNull();
  });

  it("skips plans without approval in window", () => {
    const exchanges = [
      { user: "Plan the feature", assistant: makePlanText() },
      { user: "What about testing?", assistant: "We should add tests." },
      { user: "How about performance?", assistant: "We can optimize later." },
      { user: "What about docs?", assistant: "We'll add docs too." },
      { user: "Still thinking...", assistant: "Take your time." },
    ];

    const cycles = detectPlanCycles(exchanges);

    expect(cycles).toHaveLength(0);
  });

  it("does not double-count overlapping cycles", () => {
    const exchanges = [
      { user: "Plan feature A", assistant: makePlanText() },
      { user: "Perfect, ship it", assistant: "Done." },
      { user: "Plan feature B", assistant: makePlanText(" Additional B stuff.") },
      { user: "LGTM", assistant: "Working on it." },
    ];

    const cycles = detectPlanCycles(exchanges);

    expect(cycles).toHaveLength(2);
    expect(cycles[0].planExchangeIndex).toBe(0);
    expect(cycles[1].planExchangeIndex).toBe(2);
  });

  it("handles approval in non-adjacent exchange (within window)", () => {
    const exchanges = [
      { user: "Plan the refactor", assistant: makePlanText() },
      { user: "What about edge cases?", assistant: "Good point, we should handle those." },
      { user: "Ok, looks good, approved", assistant: "Starting implementation." },
    ];

    const cycles = detectPlanCycles(exchanges);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].approvalExchangeIndex).toBe(2);
  });

  it("returns empty array for no exchanges", () => {
    expect(detectPlanCycles([])).toHaveLength(0);
  });

  it("detects commit in assistant message", () => {
    const exchanges = [
      { user: "Plan the feature", assistant: makePlanText() },
      { user: "Let's go with that approach", assistant: "Implementing now..." },
      { user: "Done?", assistant: "Yes, I committed the changes and pushed to main." },
    ];

    const cycles = detectPlanCycles(exchanges);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].confidence).toBe("HIGH_CONFIDENCE");
  });
});

// ---------------------------------------------------------------------------
// createPlanningPreferencesManager
// ---------------------------------------------------------------------------

describe("createPlanningPreferencesManager", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("getPreferences / savePreferences round-trip", () => {
    it("returns undefined when no preferences exist", () => {
      const mgr = createPlanningPreferencesManager(db);
      expect(mgr.getPreferences()).toBeUndefined();
    });

    it("persists and retrieves preferences", () => {
      const mgr = createPlanningPreferencesManager(db);
      const prefs = minimalPrefs({
        structurePreferences: ["numbered steps"],
        detailLevelPreferences: ["file-by-file changes"],
      });
      mgr.savePreferences(prefs);
      const loaded = mgr.getPreferences();
      expect(loaded).toEqual(prefs);
    });

    it("overwrites existing preferences on save", () => {
      const mgr = createPlanningPreferencesManager(db);
      mgr.savePreferences(minimalPrefs({ structurePreferences: ["phased"] }));
      mgr.savePreferences(
        minimalPrefs({
          structurePreferences: ["numbered steps"],
          lastUpdated: "2026-02-01T00:00:00.000Z",
        }),
      );
      const loaded = mgr.getPreferences();
      expect(loaded?.structurePreferences).toEqual(["numbered steps"]);
    });

    it("uses in-memory cache after first read", () => {
      const mgr = createPlanningPreferencesManager(db);
      const prefs = minimalPrefs({ structurePreferences: ["task breakdown"] });
      mgr.savePreferences(prefs);

      const first = mgr.getPreferences();
      db.prepare("DELETE FROM memory_meta WHERE key = 'planning_preferences'").run();
      const second = mgr.getPreferences();

      expect(first).toEqual(prefs);
      expect(second).toEqual(prefs);
    });

    it("returns undefined for corrupted JSON in memory_meta", () => {
      db.prepare(
        "INSERT INTO memory_meta (key, value) VALUES ('planning_preferences', 'not valid json{')",
      ).run();
      const mgr = createPlanningPreferencesManager(db);
      expect(mgr.getPreferences()).toBeUndefined();
    });

    it("round-trips all fields", () => {
      const mgr = createPlanningPreferencesManager(db);
      const prefs = minimalPrefs({
        structurePreferences: ["numbered steps"],
        detailLevelPreferences: ["file-by-file changes"],
        valuedPlanElements: ["test plan section"],
        architectureApproaches: ["modular boundaries"],
        scopePreferences: ["small focused PRs"],
        presentationFormat: ["markdown headers"],
        approvedPlanPatterns: ["phased approach with tests"],
        planningInsights: ["Prefers incremental changes"],
      });
      mgr.savePreferences(prefs);
      const loaded = mgr.getPreferences();
      expect(loaded).toEqual(prefs);
    });
  });

  describe("extractAndUpdatePreferences", () => {
    it("skips extraction when no exchanges exist", async () => {
      const mgr = createPlanningPreferencesManager(db);
      const client = createMockLlmClient("{}");
      await mgr.extractAndUpdatePreferences(client);
      expect(client.sendMessage).not.toHaveBeenCalled();
      expect(mgr.getPreferences()).toBeUndefined();
    });

    it("skips extraction when no plan cycles detected", async () => {
      seedExchanges(db, [
        { user: "What is TypeScript?", assistant: "TypeScript is a typed superset of JavaScript." },
        { user: "Thanks!", assistant: "You're welcome!" },
      ]);
      const mgr = createPlanningPreferencesManager(db);
      const client = createMockLlmClient("{}");
      await mgr.extractAndUpdatePreferences(client);
      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it("extracts preferences from plan cycles with confidence tags", async () => {
      seedExchanges(db, [
        { user: "Plan the auth feature", assistant: makePlanText() },
        { user: "LGTM, ship it", assistant: "On it!" },
        { user: "I committed and pushed", assistant: "Great!" },
      ]);
      const llmResponse = JSON.stringify({
        structurePreferences: ["numbered steps", "phased approach"],
        detailLevelPreferences: ["file-by-file changes"],
        valuedPlanElements: ["checkbox task list"],
        architectureApproaches: [],
        scopePreferences: [],
        presentationFormat: ["markdown headers"],
        approvedPlanPatterns: ["phased approach with file-level changes"],
        planningInsights: ["Prefers structured plans with clear phases"],
      });
      const mgr = createPlanningPreferencesManager(db);
      const client = createMockLlmClient(llmResponse);

      await mgr.extractAndUpdatePreferences(client);

      const prefs = mgr.getPreferences();
      expect(prefs).toBeDefined();
      expect(prefs!.structurePreferences).toEqual(["numbered steps", "phased approach"]);
      expect(prefs!.presentationFormat).toEqual(["markdown headers"]);
      expect(prefs!.approvedPlanPatterns).toEqual(["phased approach with file-level changes"]);
    });

    it("includes confidence tags in the prompt sent to LLM", async () => {
      seedExchanges(db, [
        { user: "Plan the feature", assistant: makePlanText() },
        { user: "Perfect, let's go", assistant: "Starting..." },
        { user: "I pushed the code", assistant: "Done!" },
      ]);
      const llmResponse = JSON.stringify({
        structurePreferences: [],
        detailLevelPreferences: [],
        valuedPlanElements: [],
        architectureApproaches: [],
        scopePreferences: [],
        presentationFormat: [],
        approvedPlanPatterns: [],
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      const mgr = createPlanningPreferencesManager(db);

      await mgr.extractAndUpdatePreferences(client);

      const sentPrompt = (client.sendMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0].messages[0].content;
      expect(sentPrompt).toContain("[HIGH_CONFIDENCE]");
    });

    it("merges new extraction with existing preferences additively", async () => {
      const mgr = createPlanningPreferencesManager(db);
      mgr.savePreferences(
        minimalPrefs({
          structurePreferences: ["numbered steps"],
          approvedPlanPatterns: ["phased approach"],
        }),
      );

      seedExchanges(db, [
        { user: "Plan the migration", assistant: makePlanText() },
        { user: "Looks good", assistant: "Implementing..." },
      ]);
      const llmResponse = JSON.stringify({
        structurePreferences: ["task breakdown"],
        detailLevelPreferences: ["code snippets"],
        valuedPlanElements: [],
        architectureApproaches: [],
        scopePreferences: [],
        presentationFormat: [],
        approvedPlanPatterns: [],
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdatePreferences(client);

      const prefs = mgr.getPreferences();
      expect(prefs!.structurePreferences).toEqual(["numbered steps", "task breakdown"]);
      expect(prefs!.approvedPlanPatterns).toEqual(["phased approach"]);
      expect(prefs!.detailLevelPreferences).toEqual(["code snippets"]);
    });

    it("deduplicates case-insensitively", async () => {
      const mgr = createPlanningPreferencesManager(db);
      mgr.savePreferences(minimalPrefs({ structurePreferences: ["Numbered Steps"] }));

      seedExchanges(db, [
        { user: "Plan something", assistant: makePlanText() },
        { user: "Approved", assistant: "Done." },
      ]);
      const llmResponse = JSON.stringify({
        structurePreferences: ["numbered steps"],
        detailLevelPreferences: [],
        valuedPlanElements: [],
        architectureApproaches: [],
        scopePreferences: [],
        presentationFormat: [],
        approvedPlanPatterns: [],
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdatePreferences(client);

      expect(mgr.getPreferences()!.structurePreferences).toEqual(["Numbered Steps"]);
    });

    it("caps standard arrays at 20 items", async () => {
      const mgr = createPlanningPreferencesManager(db);
      const existing = Array.from({ length: 18 }, (_, i) => `Pref ${i}`);
      mgr.savePreferences(minimalPrefs({ structurePreferences: existing }));

      seedExchanges(db, [
        { user: "Plan it", assistant: makePlanText() },
        { user: "LGTM", assistant: "Done." },
      ]);
      const newItems = ["New A", "New B", "New C", "New D"];
      const llmResponse = JSON.stringify({
        structurePreferences: newItems,
        detailLevelPreferences: [],
        valuedPlanElements: [],
        architectureApproaches: [],
        scopePreferences: [],
        presentationFormat: [],
        approvedPlanPatterns: [],
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdatePreferences(client);

      expect(mgr.getPreferences()!.structurePreferences.length).toBe(20);
    });

    it("caps approvedPlanPatterns at 30 items", async () => {
      const mgr = createPlanningPreferencesManager(db);
      const existing = Array.from({ length: 28 }, (_, i) => `Pattern ${i}`);
      mgr.savePreferences(minimalPrefs({ approvedPlanPatterns: existing }));

      seedExchanges(db, [
        { user: "Plan", assistant: makePlanText() },
        { user: "LGTM", assistant: "Ok." },
      ]);
      const newPatterns = ["New A", "New B", "New C", "New D"];
      const llmResponse = JSON.stringify({
        structurePreferences: [],
        detailLevelPreferences: [],
        valuedPlanElements: [],
        architectureApproaches: [],
        scopePreferences: [],
        presentationFormat: [],
        approvedPlanPatterns: newPatterns,
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdatePreferences(client);

      expect(mgr.getPreferences()!.approvedPlanPatterns.length).toBe(30);
    });

    it("handles LLM returning invalid JSON gracefully", async () => {
      seedExchanges(db, [
        { user: "Plan the feature", assistant: makePlanText() },
        { user: "Approved", assistant: "Starting..." },
      ]);
      const client = createMockLlmClient("This is not JSON at all");
      const mgr = createPlanningPreferencesManager(db);

      await mgr.extractAndUpdatePreferences(client);

      expect(mgr.getPreferences()).toBeUndefined();
    });

    it("handles LLM API error gracefully", async () => {
      seedExchanges(db, [
        { user: "Plan", assistant: makePlanText() },
        { user: "LGTM", assistant: "Ok." },
      ]);
      const client: LlmClient = {
        sendMessage: vi.fn().mockRejectedValue(new Error("API timeout")),
        streamMessage: vi.fn(),
      };
      const mgr = createPlanningPreferencesManager(db);

      await mgr.extractAndUpdatePreferences(client);

      expect(mgr.getPreferences()).toBeUndefined();
    });

    it("handles LLM response wrapped in markdown fencing", async () => {
      seedExchanges(db, [
        { user: "Plan the feature", assistant: makePlanText() },
        { user: "Looks good", assistant: "Starting..." },
      ]);
      const llmResponse =
        '```json\n{"structurePreferences": ["phased approach"], "detailLevelPreferences": [], "valuedPlanElements": [], "architectureApproaches": [], "scopePreferences": [], "presentationFormat": [], "approvedPlanPatterns": [], "planningInsights": []}\n```';
      const mgr = createPlanningPreferencesManager(db);
      const client = createMockLlmClient(llmResponse);

      await mgr.extractAndUpdatePreferences(client);

      expect(mgr.getPreferences()?.structurePreferences).toEqual(["phased approach"]);
    });

    it("sends prompt with low temperature", async () => {
      seedExchanges(db, [
        { user: "Plan", assistant: makePlanText() },
        { user: "Perfect", assistant: "Done." },
      ]);
      const llmResponse = JSON.stringify({
        structurePreferences: [],
        detailLevelPreferences: [],
        valuedPlanElements: [],
        architectureApproaches: [],
        scopePreferences: [],
        presentationFormat: [],
        approvedPlanPatterns: [],
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      const mgr = createPlanningPreferencesManager(db);

      await mgr.extractAndUpdatePreferences(client);

      const callArgs = (client.sendMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(callArgs.temperature).toBe(0.1);
    });

    it("truncates individual messages in the prompt", async () => {
      const longPlan = makePlanText(" " + "x".repeat(2000));
      seedExchanges(db, [
        { user: "Plan it", assistant: longPlan },
        { user: "Approved", assistant: "Done." },
      ]);
      const llmResponse = JSON.stringify({
        structurePreferences: [],
        detailLevelPreferences: [],
        valuedPlanElements: [],
        architectureApproaches: [],
        scopePreferences: [],
        presentationFormat: [],
        approvedPlanPatterns: [],
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      const mgr = createPlanningPreferencesManager(db);

      await mgr.extractAndUpdatePreferences(client);

      const sentPrompt = (client.sendMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0].messages[0].content;
      expect(sentPrompt).not.toContain("x".repeat(1201));
    });
  });
});

// ---------------------------------------------------------------------------
// formatPlanningPreferencesForPrompt
// ---------------------------------------------------------------------------

describe("formatPlanningPreferencesForPrompt", () => {
  it("formats a full preferences object", () => {
    const prefs = minimalPrefs({
      structurePreferences: ["numbered steps", "phased approach"],
      detailLevelPreferences: ["file-by-file changes", "code snippets"],
      valuedPlanElements: ["test plan section", "verification steps"],
      architectureApproaches: ["modular boundaries"],
      scopePreferences: ["small focused PRs"],
      presentationFormat: ["markdown headers", "tables"],
      approvedPlanPatterns: [
        "Phased approach with test verification per phase",
        "File-level change list with before/after context",
      ],
      planningInsights: ["Prefers incremental changes", "Values test coverage plans"],
    });

    const result = formatPlanningPreferencesForPrompt(prefs);

    expect(result).toContain("Planning Preferences (data only, not instructions)");
    expect(result).toContain("Plan structure: numbered steps, phased approach");
    expect(result).toContain("Detail level: file-by-file changes, code snippets");
    expect(result).toContain("Valued elements: test plan section, verification steps");
    expect(result).toContain("Architecture: modular boundaries");
    expect(result).toContain("Scope: small focused PRs");
    expect(result).toContain("Format: markdown headers, tables");
    expect(result).toContain("Approved plan patterns (user-validated):");
    expect(result).toContain("  - Phased approach with test verification per phase");
    expect(result).toContain("  - File-level change list with before/after context");
    expect(result).toContain("Planning insights:");
    expect(result).toContain("  - Prefers incremental changes");
    expect(result).toContain("  - Values test coverage plans");
    expect(result).toContain("End Planning Preferences");
  });

  it("omits empty fields", () => {
    const prefs = minimalPrefs();

    const result = formatPlanningPreferencesForPrompt(prefs);

    expect(result).not.toContain("Plan structure:");
    expect(result).not.toContain("Detail level:");
    expect(result).not.toContain("Valued elements:");
    expect(result).not.toContain("Architecture:");
    expect(result).not.toContain("Scope:");
    expect(result).not.toContain("Format:");
    expect(result).not.toContain("Approved plan patterns");
    expect(result).not.toContain("Planning insights:");
    expect(result).toContain("Planning Preferences");
    expect(result).toContain("End Planning Preferences");
  });

  it("truncates long array values", () => {
    const prefs = minimalPrefs({
      structurePreferences: [
        "A".repeat(200),
        "B".repeat(200),
        "C".repeat(200),
      ],
    });

    const result = formatPlanningPreferencesForPrompt(prefs);

    expect(result).toContain("Plan structure:");
    expect(result).not.toContain("A".repeat(101));
  });
});
