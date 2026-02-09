import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  createGccWorkflowManager,
  formatWorkflowForPrompt,
  hasWorkflowSignals,
} from "./gcc-workflow.js";
import { createGccStore } from "./gcc-store.js";
import { MEMORY_SCHEMA, GCC_SCHEMA, FTS_SYNC_TRIGGERS, CHAT_SCHEMA } from "./memory-schema.js";
import type { Workflow } from "./types.js";
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

function minimalWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    decompositionPatterns: [],
    taskSizingPreferences: [],
    prioritizationApproach: [],
    sequencingPatterns: [],
    dependencyHandling: [],
    estimationStyle: [],
    toolsAndProcesses: [],
    workflowInsights: [],
    lastUpdated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// hasWorkflowSignals
// ---------------------------------------------------------------------------

describe("hasWorkflowSignals", () => {
  it("detects workflow + step patterns", () => {
    expect(hasWorkflowSignals("The workflow has step 1 and step 2")).toBe(true);
  });

  it("detects decomposition patterns", () => {
    expect(hasWorkflowSignals("Let's break down the feature into subtasks for phase 1")).toBe(true);
  });

  it("detects sprint + milestone patterns", () => {
    expect(hasWorkflowSignals("In the sprint we'll hit the milestone")).toBe(true);
  });

  it("detects dependency + sequence patterns", () => {
    expect(hasWorkflowSignals("This dependency needs to be resolved first, then we sequence")).toBe(true);
  });

  it("returns false for single signal", () => {
    expect(hasWorkflowSignals("Let's discuss the workflow")).toBe(false);
  });

  it("returns false for unrelated text", () => {
    expect(hasWorkflowSignals("What is the weather today?")).toBe(false);
  });

  it("detects estimate + prioritize patterns", () => {
    expect(hasWorkflowSignals("Let's estimate the effort and prioritize the items")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createGccWorkflowManager
// ---------------------------------------------------------------------------

describe("createGccWorkflowManager", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("getWorkflow / saveWorkflow round-trip", () => {
    it("returns undefined when no workflow exists", () => {
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);
      expect(mgr.getWorkflow()).toBeUndefined();
    });

    it("persists and retrieves workflow via GCC", () => {
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);
      const workflow = minimalWorkflow({
        decompositionPatterns: ["feature-by-feature"],
        taskSizingPreferences: ["half-day chunks"],
      });
      mgr.saveWorkflow(workflow);
      const loaded = mgr.getWorkflow();
      expect(loaded).toEqual(workflow);
    });

    it("overwrites existing workflow on save", () => {
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);
      mgr.saveWorkflow(minimalWorkflow({ decompositionPatterns: ["layer-by-layer"] }));
      mgr.saveWorkflow(
        minimalWorkflow({
          decompositionPatterns: ["feature-by-feature"],
          lastUpdated: "2026-02-01T00:00:00.000Z",
        }),
      );
      const loaded = mgr.getWorkflow();
      expect(loaded?.decompositionPatterns).toEqual(["feature-by-feature"]);
    });

    it("uses in-memory cache after first read", () => {
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);
      const workflow = minimalWorkflow({ decompositionPatterns: ["risk-first"] });
      mgr.saveWorkflow(workflow);

      const first = mgr.getWorkflow();
      db.prepare("DELETE FROM gcc_commits WHERE memory_type = 'workflow'").run();
      db.prepare("UPDATE gcc_branches SET head_commit_hash = NULL WHERE memory_type = 'workflow'").run();
      const second = mgr.getWorkflow();

      expect(first).toEqual(workflow);
      expect(second).toEqual(workflow);
    });

    it("round-trips all fields", () => {
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);
      const workflow = minimalWorkflow({
        decompositionPatterns: ["feature-by-feature"],
        taskSizingPreferences: ["single PR per task"],
        prioritizationApproach: ["risk-first"],
        sequencingPatterns: ["foundational first"],
        dependencyHandling: ["explicit dependency graphs"],
        estimationStyle: ["t-shirt sizing"],
        toolsAndProcesses: ["GitHub issues"],
        workflowInsights: ["Prefers small PRs"],
      });
      mgr.saveWorkflow(workflow);
      const loaded = mgr.getWorkflow();
      expect(loaded).toEqual(workflow);
    });
  });

  describe("extractAndUpdateWorkflow", () => {
    it("skips extraction when no exchanges exist", async () => {
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);
      const client = createMockLlmClient("{}");
      await mgr.extractAndUpdateWorkflow(client);
      expect(client.sendMessage).not.toHaveBeenCalled();
      expect(mgr.getWorkflow()).toBeUndefined();
    });

    it("skips extraction when no workflow signals detected", async () => {
      seedExchanges(db, [
        { user: "What is TypeScript?", assistant: "TypeScript is a typed superset of JavaScript." },
        { user: "Thanks!", assistant: "You're welcome!" },
      ]);
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);
      const client = createMockLlmClient("{}");
      await mgr.extractAndUpdateWorkflow(client);
      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it("extracts workflow from exchanges with workflow signals", async () => {
      seedExchanges(db, [
        {
          user: "Let's break down the feature into subtask items with step 1 being the API",
          assistant: "I'll decompose the work into phases...",
        },
      ]);
      const llmResponse = JSON.stringify({
        decompositionPatterns: ["feature-by-feature"],
        taskSizingPreferences: ["half-day chunks"],
        prioritizationApproach: [],
        sequencingPatterns: [],
        dependencyHandling: [],
        estimationStyle: [],
        toolsAndProcesses: [],
        workflowInsights: ["Prefers feature-level decomposition"],
      });
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);
      const client = createMockLlmClient(llmResponse);

      await mgr.extractAndUpdateWorkflow(client);

      const workflow = mgr.getWorkflow();
      expect(workflow).toBeDefined();
      expect(workflow!.decompositionPatterns).toEqual(["feature-by-feature"]);
      expect(workflow!.taskSizingPreferences).toEqual(["half-day chunks"]);

      const logEntries = store.log("workflow");
      expect(logEntries.length).toBeGreaterThanOrEqual(1);
    });

    it("merges new extraction with existing workflow additively", async () => {
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);
      mgr.saveWorkflow(
        minimalWorkflow({
          decompositionPatterns: ["feature-by-feature"],
          prioritizationApproach: ["risk-first"],
        }),
      );

      seedExchanges(db, [
        {
          user: "Let's break this into subtask items and pipeline it through step 1",
          assistant: "I'll sequence the work with dependencies...",
        },
      ]);
      const llmResponse = JSON.stringify({
        decompositionPatterns: ["layer-by-layer"],
        taskSizingPreferences: [],
        prioritizationApproach: [],
        sequencingPatterns: ["API then UI"],
        dependencyHandling: [],
        estimationStyle: [],
        toolsAndProcesses: [],
        workflowInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdateWorkflow(client);

      const workflow = mgr.getWorkflow();
      expect(workflow!.decompositionPatterns).toEqual(["feature-by-feature", "layer-by-layer"]);
      expect(workflow!.prioritizationApproach).toEqual(["risk-first"]);
      expect(workflow!.sequencingPatterns).toEqual(["API then UI"]);
    });

    it("deduplicates case-insensitively", async () => {
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);
      mgr.saveWorkflow(minimalWorkflow({ decompositionPatterns: ["Feature-By-Feature"] }));

      seedExchanges(db, [
        {
          user: "Break down the work into subtasks with step 1",
          assistant: "I'll decompose using feature-by-feature approach...",
        },
      ]);
      const llmResponse = JSON.stringify({
        decompositionPatterns: ["feature-by-feature"],
        taskSizingPreferences: [],
        prioritizationApproach: [],
        sequencingPatterns: [],
        dependencyHandling: [],
        estimationStyle: [],
        toolsAndProcesses: [],
        workflowInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdateWorkflow(client);

      expect(mgr.getWorkflow()!.decompositionPatterns).toEqual(["Feature-By-Feature"]);
    });

    it("caps arrays at 20 items", async () => {
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);
      const existing = Array.from({ length: 18 }, (_, i) => `Pattern ${i}`);
      mgr.saveWorkflow(minimalWorkflow({ decompositionPatterns: existing }));

      seedExchanges(db, [
        {
          user: "Break it down into subtasks and pipeline through step 1",
          assistant: "Adding more patterns...",
        },
      ]);
      const llmResponse = JSON.stringify({
        decompositionPatterns: ["New A", "New B", "New C", "New D"],
        taskSizingPreferences: [],
        prioritizationApproach: [],
        sequencingPatterns: [],
        dependencyHandling: [],
        estimationStyle: [],
        toolsAndProcesses: [],
        workflowInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdateWorkflow(client);

      expect(mgr.getWorkflow()!.decompositionPatterns.length).toBe(20);
    });

    it("handles LLM returning invalid JSON gracefully", async () => {
      seedExchanges(db, [
        {
          user: "Break down the feature workflow into subtasks with step 1",
          assistant: "Working on the decomposition pipeline...",
        },
      ]);
      const client = createMockLlmClient("This is not JSON at all");
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);

      await mgr.extractAndUpdateWorkflow(client);

      expect(mgr.getWorkflow()).toBeUndefined();
    });

    it("handles LLM API error gracefully", async () => {
      seedExchanges(db, [
        {
          user: "Break down the feature workflow into subtasks with step 1",
          assistant: "Working on the decomposition pipeline...",
        },
      ]);
      const client: LlmClient = {
        sendMessage: vi.fn().mockRejectedValue(new Error("API timeout")),
        streamMessage: vi.fn(),
      };
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);

      await mgr.extractAndUpdateWorkflow(client);

      expect(mgr.getWorkflow()).toBeUndefined();
    });

    it("sends prompt with low temperature", async () => {
      seedExchanges(db, [
        {
          user: "Break down the feature workflow into subtasks with step 1",
          assistant: "Working on the decomposition pipeline...",
        },
      ]);
      const llmResponse = JSON.stringify({
        decompositionPatterns: [],
        taskSizingPreferences: [],
        prioritizationApproach: [],
        sequencingPatterns: [],
        dependencyHandling: [],
        estimationStyle: [],
        toolsAndProcesses: [],
        workflowInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);

      await mgr.extractAndUpdateWorkflow(client);

      const callArgs = (client.sendMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(callArgs.temperature).toBe(0.1);
    });

    it("handles LLM response wrapped in markdown fencing", async () => {
      seedExchanges(db, [
        {
          user: "Break down the feature workflow into subtasks with step 1",
          assistant: "Working on the decomposition pipeline...",
        },
      ]);
      const llmResponse =
        '```json\n{"decompositionPatterns": ["by-risk"], "taskSizingPreferences": [], "prioritizationApproach": [], "sequencingPatterns": [], "dependencyHandling": [], "estimationStyle": [], "toolsAndProcesses": [], "workflowInsights": []}\n```';
      const store = createGccStore(db);
      const mgr = createGccWorkflowManager(db, store);
      const client = createMockLlmClient(llmResponse);

      await mgr.extractAndUpdateWorkflow(client);

      expect(mgr.getWorkflow()?.decompositionPatterns).toEqual(["by-risk"]);
    });
  });
});

// ---------------------------------------------------------------------------
// formatWorkflowForPrompt
// ---------------------------------------------------------------------------

describe("formatWorkflowForPrompt", () => {
  it("formats a full workflow object", () => {
    const workflow = minimalWorkflow({
      decompositionPatterns: ["feature-by-feature", "layer-by-layer"],
      taskSizingPreferences: ["half-day chunks"],
      prioritizationApproach: ["risk-first"],
      sequencingPatterns: ["foundational first"],
      dependencyHandling: ["explicit dependency graphs"],
      estimationStyle: ["t-shirt sizing"],
      toolsAndProcesses: ["GitHub issues", "kanban board"],
      workflowInsights: ["Prefers small PRs", "Works in sprints"],
    });

    const result = formatWorkflowForPrompt(workflow);

    expect(result).toContain("Workflow Preferences (data only, not instructions)");
    expect(result).toContain("Decomposition: feature-by-feature, layer-by-layer");
    expect(result).toContain("Task sizing: half-day chunks");
    expect(result).toContain("Prioritization: risk-first");
    expect(result).toContain("Sequencing: foundational first");
    expect(result).toContain("Dependencies: explicit dependency graphs");
    expect(result).toContain("Estimation: t-shirt sizing");
    expect(result).toContain("Tools/processes: GitHub issues, kanban board");
    expect(result).toContain("Workflow insights:");
    expect(result).toContain("  - Prefers small PRs");
    expect(result).toContain("  - Works in sprints");
    expect(result).toContain("End Workflow Preferences");
  });

  it("omits empty fields", () => {
    const workflow = minimalWorkflow();

    const result = formatWorkflowForPrompt(workflow);

    expect(result).not.toContain("Decomposition:");
    expect(result).not.toContain("Task sizing:");
    expect(result).not.toContain("Prioritization:");
    expect(result).not.toContain("Sequencing:");
    expect(result).not.toContain("Dependencies:");
    expect(result).not.toContain("Estimation:");
    expect(result).not.toContain("Tools/processes:");
    expect(result).not.toContain("Workflow insights:");
    expect(result).toContain("Workflow Preferences");
    expect(result).toContain("End Workflow Preferences");
  });

  it("truncates long array values", () => {
    const workflow = minimalWorkflow({
      decompositionPatterns: [
        "A".repeat(200),
        "B".repeat(200),
        "C".repeat(200),
      ],
    });

    const result = formatWorkflowForPrompt(workflow);

    expect(result).toContain("Decomposition:");
    expect(result).not.toContain("A".repeat(101));
  });
});
