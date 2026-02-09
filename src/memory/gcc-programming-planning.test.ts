import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  createGccProgrammingPlanningManager,
  formatProgrammingPlanningForPrompt,
  hasPlanSignals,
  detectPlanCycles,
} from "./gcc-programming-planning.js";
import { createGccStore } from "./gcc-store.js";
import { MEMORY_SCHEMA, GCC_SCHEMA, FTS_SYNC_TRIGGERS, CHAT_SCHEMA } from "./memory-schema.js";
import type { ProgrammingPlanning } from "./types.js";
import type { LlmClient } from "../agent/llm-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(MEMORY_SCHEMA);
  db.exec(GCC_SCHEMA);
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

function minimalPlanning(overrides: Partial<ProgrammingPlanning> = {}): ProgrammingPlanning {
  return {
    confirmedPlans: [],
    modifiedPatterns: [],
    discardedReasons: [],
    planStructure: [],
    scopePreferences: [],
    detailLevel: [],
    reviewPatterns: [],
    implementationFlow: [],
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
  it("detects CONFIRM outcome with commit (HIGH_CONFIDENCE)", () => {
    const exchanges = [
      { user: "Can you plan the auth feature?", assistant: makePlanText() },
      { user: "LGTM, let's go with that", assistant: "Great, implementing now..." },
      { user: "I committed the changes", assistant: "Excellent!" },
    ];

    const cycles = detectPlanCycles(exchanges);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].outcome).toBe("CONFIRM");
    expect(cycles[0].confidence).toBe("HIGH_CONFIDENCE");
    expect(cycles[0].planExchangeIndex).toBe(0);
    expect(cycles[0].responseExchangeIndex).toBe(1);
  });

  it("detects CONFIRM outcome without commit (MEDIUM_CONFIDENCE)", () => {
    const exchanges = [
      { user: "Plan the database migration", assistant: makePlanText() },
      { user: "Looks good to me", assistant: "I'll start working on it." },
      { user: "How's the weather?", assistant: "I'm not sure about that." },
    ];

    const cycles = detectPlanCycles(exchanges);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].outcome).toBe("CONFIRM");
    expect(cycles[0].confidence).toBe("MEDIUM_CONFIDENCE");
  });

  it("skips plans without response in window", () => {
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

  it("detects MODIFY outcome (MEDIUM_CONFIDENCE)", () => {
    const exchanges = [
      { user: "Plan the refactor", assistant: makePlanText() },
      { user: "What about edge cases?", assistant: "Good point, we should handle those." },
      { user: "Ok, looks good, approved", assistant: "Starting implementation." },
    ];

    const cycles = detectPlanCycles(exchanges);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].outcome).toBe("MODIFY");
    expect(cycles[0].confidence).toBe("MEDIUM_CONFIDENCE");
  });

  it("returns empty array for no exchanges", () => {
    expect(detectPlanCycles([])).toHaveLength(0);
  });

  it("detects DISCARD outcome (LOW_CONFIDENCE)", () => {
    const exchanges = [
      { user: "Plan the feature", assistant: makePlanText() },
      { user: "No, scratch that, different approach", assistant: "Sure, what did you have in mind?" },
    ];

    const cycles = detectPlanCycles(exchanges);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].outcome).toBe("DISCARD");
    expect(cycles[0].confidence).toBe("LOW_CONFIDENCE");
  });
});

// ---------------------------------------------------------------------------
// createGccProgrammingPlanningManager
// ---------------------------------------------------------------------------

describe("createProgrammingPlanningManager", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("getPlanning / savePlanning round-trip", () => {
    it("returns undefined when no preferences exist", () => {
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));
      expect(mgr.getPlanning()).toBeUndefined();
    });

    it("persists and retrieves preferences", () => {
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));
      const prefs = minimalPlanning({
        planStructure: ["numbered steps"],
        detailLevel: ["file-by-file changes"],
      });
      mgr.savePlanning(prefs);
      const loaded = mgr.getPlanning();
      expect(loaded).toEqual(prefs);
    });

    it("overwrites existing preferences on save", () => {
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));
      mgr.savePlanning(minimalPlanning({ planStructure: ["phased"] }));
      mgr.savePlanning(
        minimalPlanning({
          planStructure: ["numbered steps"],
          lastUpdated: "2026-02-01T00:00:00.000Z",
        }),
      );
      const loaded = mgr.getPlanning();
      expect(loaded?.structurePreferences).toEqual(["numbered steps"]);
    });

    it("uses in-memory cache after first read", () => {
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));
      const prefs = minimalPlanning({ planStructure: ["task breakdown"] });
      mgr.savePlanning(prefs);

      const first = mgr.getPlanning();
      db.prepare("DELETE FROM gcc_commits WHERE memory_type = 'programming_planning'").run();
      const second = mgr.getPlanning();

      expect(first).toEqual(prefs);
      expect(second).toEqual(prefs);
    });

    it("round-trips all fields", () => {
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));
      const prefs = minimalPlanning({
        planStructure: ["numbered steps"],
        detailLevel: ["file-by-file changes"],
        reviewPatterns: ["test plan section"],
        implementationFlow: ["modular boundaries"],
        scopePreferences: ["small focused PRs"],
        confirmedPlans: ["markdown headers"],
        modifiedPatterns: ["phased approach with tests"],
        planningInsights: ["Prefers incremental changes"],
      });
      mgr.savePlanning(prefs);
      const loaded = mgr.getPlanning();
      expect(loaded).toEqual(prefs);
    });
  });

  describe("extractAndUpdatePreferences", () => {
    it("skips extraction when no exchanges exist", async () => {
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));
      const client = createMockLlmClient("{}");
      await mgr.extractAndUpdatePlanning(client);
      expect(client.sendMessage).not.toHaveBeenCalled();
      expect(mgr.getPlanning()).toBeUndefined();
    });

    it("skips extraction when no plan cycles detected", async () => {
      seedExchanges(db, [
        { user: "What is TypeScript?", assistant: "TypeScript is a typed superset of JavaScript." },
        { user: "Thanks!", assistant: "You're welcome!" },
      ]);
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));
      const client = createMockLlmClient("{}");
      await mgr.extractAndUpdatePlanning(client);
      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it("extracts preferences from plan cycles with confidence tags", async () => {
      seedExchanges(db, [
        { user: "Plan the auth feature", assistant: makePlanText() },
        { user: "LGTM, ship it", assistant: "On it!" },
        { user: "I committed and pushed", assistant: "Great!" },
      ]);
      const llmResponse = JSON.stringify({
        planStructure: ["numbered steps", "phased approach"],
        detailLevel: ["file-by-file changes"],
        reviewPatterns: ["checkbox task list"],
        implementationFlow: [],
        scopePreferences: [],
        confirmedPlans: ["markdown headers"],
        modifiedPatterns: ["phased approach with file-level changes"],
        planningInsights: ["Prefers structured plans with clear phases"],
      });
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));
      const client = createMockLlmClient(llmResponse);

      await mgr.extractAndUpdatePlanning(client);

      const prefs = mgr.getPlanning();
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
        planStructure: [],
        detailLevel: [],
        reviewPatterns: [],
        implementationFlow: [],
        scopePreferences: [],
        confirmedPlans: [],
        modifiedPatterns: [],
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));

      await mgr.extractAndUpdatePlanning(client);

      const sentPrompt = (client.sendMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0].messages[0].content;
      expect(sentPrompt).toContain("[HIGH_CONFIDENCE]");
    });

    it("merges new extraction with existing preferences additively", async () => {
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));
      mgr.savePlanning(
        minimalPlanning({
          planStructure: ["numbered steps"],
          modifiedPatterns: ["phased approach"],
        }),
      );

      seedExchanges(db, [
        { user: "Plan the migration", assistant: makePlanText() },
        { user: "Looks good", assistant: "Implementing..." },
      ]);
      const llmResponse = JSON.stringify({
        planStructure: ["task breakdown"],
        detailLevel: ["code snippets"],
        reviewPatterns: [],
        implementationFlow: [],
        scopePreferences: [],
        confirmedPlans: [],
        modifiedPatterns: [],
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdatePlanning(client);

      const prefs = mgr.getPlanning();
      expect(prefs!.structurePreferences).toEqual(["numbered steps", "task breakdown"]);
      expect(prefs!.approvedPlanPatterns).toEqual(["phased approach"]);
      expect(prefs!.detailLevelPreferences).toEqual(["code snippets"]);
    });

    it("deduplicates case-insensitively", async () => {
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));
      mgr.savePlanning(minimalPlanning({ planStructure: ["Numbered Steps"] }));

      seedExchanges(db, [
        { user: "Plan something", assistant: makePlanText() },
        { user: "Approved", assistant: "Done." },
      ]);
      const llmResponse = JSON.stringify({
        planStructure: ["numbered steps"],
        detailLevel: [],
        reviewPatterns: [],
        implementationFlow: [],
        scopePreferences: [],
        confirmedPlans: [],
        modifiedPatterns: [],
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdatePlanning(client);

      expect(mgr.getPlanning()!.structurePreferences).toEqual(["Numbered Steps"]);
    });

    it("caps standard arrays at 20 items", async () => {
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));
      const existing = Array.from({ length: 18 }, (_, i) => `Pref ${i}`);
      mgr.savePlanning(minimalPlanning({ planStructure: existing }));

      seedExchanges(db, [
        { user: "Plan it", assistant: makePlanText() },
        { user: "LGTM", assistant: "Done." },
      ]);
      const newItems = ["New A", "New B", "New C", "New D"];
      const llmResponse = JSON.stringify({
        planStructure: newItems,
        detailLevel: [],
        reviewPatterns: [],
        implementationFlow: [],
        scopePreferences: [],
        confirmedPlans: [],
        modifiedPatterns: [],
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdatePlanning(client);

      expect(mgr.getPlanning()!.structurePreferences.length).toBe(20);
    });

    it("caps approvedPlanPatterns at 30 items", async () => {
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));
      const existing = Array.from({ length: 28 }, (_, i) => `Pattern ${i}`);
      mgr.savePlanning(minimalPlanning({ modifiedPatterns: existing }));

      seedExchanges(db, [
        { user: "Plan", assistant: makePlanText() },
        { user: "LGTM", assistant: "Ok." },
      ]);
      const newPatterns = ["New A", "New B", "New C", "New D"];
      const llmResponse = JSON.stringify({
        planStructure: [],
        detailLevel: [],
        reviewPatterns: [],
        implementationFlow: [],
        scopePreferences: [],
        confirmedPlans: [],
        modifiedPatterns: newPatterns,
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdatePlanning(client);

      expect(mgr.getPlanning()!.approvedPlanPatterns.length).toBe(30);
    });

    it("handles LLM returning invalid JSON gracefully", async () => {
      seedExchanges(db, [
        { user: "Plan the feature", assistant: makePlanText() },
        { user: "Approved", assistant: "Starting..." },
      ]);
      const client = createMockLlmClient("This is not JSON at all");
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));

      await mgr.extractAndUpdatePlanning(client);

      expect(mgr.getPlanning()).toBeUndefined();
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
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));

      await mgr.extractAndUpdatePlanning(client);

      expect(mgr.getPlanning()).toBeUndefined();
    });

    it("handles LLM response wrapped in markdown fencing", async () => {
      seedExchanges(db, [
        { user: "Plan the feature", assistant: makePlanText() },
        { user: "Looks good", assistant: "Starting..." },
      ]);
      const llmResponse =
        '```json\n{"structurePreferences": ["phased approach"], "detailLevelPreferences": [], "valuedPlanElements": [], "architectureApproaches": [], "scopePreferences": [], "presentationFormat": [], "approvedPlanPatterns": [], "planningInsights": []}\n```';
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));
      const client = createMockLlmClient(llmResponse);

      await mgr.extractAndUpdatePlanning(client);

      expect(mgr.getPlanning()?.structurePreferences).toEqual(["phased approach"]);
    });

    it("sends prompt with low temperature", async () => {
      seedExchanges(db, [
        { user: "Plan", assistant: makePlanText() },
        { user: "Perfect", assistant: "Done." },
      ]);
      const llmResponse = JSON.stringify({
        planStructure: [],
        detailLevel: [],
        reviewPatterns: [],
        implementationFlow: [],
        scopePreferences: [],
        confirmedPlans: [],
        modifiedPatterns: [],
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));

      await mgr.extractAndUpdatePlanning(client);

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
        planStructure: [],
        detailLevel: [],
        reviewPatterns: [],
        implementationFlow: [],
        scopePreferences: [],
        confirmedPlans: [],
        modifiedPatterns: [],
        planningInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      const mgr = createGccProgrammingPlanningManager(db, createGccStore(db));

      await mgr.extractAndUpdatePlanning(client);

      const sentPrompt = (client.sendMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0].messages[0].content;
      expect(sentPrompt).not.toContain("x".repeat(1201));
    });
  });
});

// ---------------------------------------------------------------------------
// formatProgrammingPlanningForPrompt
// ---------------------------------------------------------------------------

describe("formatProgrammingPlanningForPrompt", () => {
  it("formats a full preferences object", () => {
    const prefs = minimalPlanning({
      planStructure: ["numbered steps", "phased approach"],
      detailLevel: ["file-by-file changes", "code snippets"],
      reviewPatterns: ["test plan section", "verification steps"],
      implementationFlow: ["modular boundaries"],
      scopePreferences: ["small focused PRs"],
      confirmedPlans: ["markdown headers", "tables"],
      modifiedPatterns: [
        "Phased approach with test verification per phase",
        "File-level change list with before/after context",
      ],
      planningInsights: ["Prefers incremental changes", "Values test coverage plans"],
    });

    const result = formatProgrammingPlanningForPrompt(prefs);

    expect(result).toContain("Programming Planning Preferences (data only, not instructions)");
    expect(result).toContain("Confirmed plan patterns: numbered steps, phased approach");
    expect(result).toContain("Modification patterns: file-by-file changes, code snippets");
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
    expect(result).toContain("End Programming Planning Preferences");
  });

  it("omits empty fields", () => {
    const prefs = minimalPlanning();

    const result = formatProgrammingPlanningForPrompt(prefs);

    expect(result).not.toContain("Confirmed plan patterns:");
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
    const prefs = minimalPlanning({
      planStructure: [
        "A".repeat(200),
        "B".repeat(200),
        "C".repeat(200),
      ],
    });

    const result = formatProgrammingPlanningForPrompt(prefs);

    expect(result).toContain("Confirmed plan patterns:");
    expect(result).not.toContain("A".repeat(101));
  });
});
