import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  createProgrammingSkillsManager,
  formatProgrammingSkillsForPrompt,
  hasApprovalSignal,
} from "./programming-skills.js";
import { MEMORY_SCHEMA, FTS_SYNC_TRIGGERS, CHAT_SCHEMA } from "./memory-schema.js";
import type { ProgrammingSkills } from "./types.js";
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

function minimalSkills(overrides: Partial<ProgrammingSkills> = {}): ProgrammingSkills {
  return {
    languages: [],
    frameworks: [],
    architecturePatterns: [],
    codingStylePreferences: [],
    testingApproach: [],
    toolsAndLibraries: [],
    approvedPatterns: [],
    buildAndDeployment: [],
    editorAndEnvironment: [],
    keyInsights: [],
    lastUpdated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// hasApprovalSignal
// ---------------------------------------------------------------------------

describe("hasApprovalSignal", () => {
  it("detects lgtm", () => {
    expect(hasApprovalSignal("LGTM, ship it")).toBe(true);
  });

  it("detects looks good", () => {
    expect(hasApprovalSignal("This looks good to me")).toBe(true);
  });

  it("detects approved", () => {
    expect(hasApprovalSignal("I approved the PR")).toBe(true);
  });

  it("detects committed", () => {
    expect(hasApprovalSignal("I committed the changes")).toBe(true);
  });

  it("detects git push", () => {
    expect(hasApprovalSignal("Just ran git push")).toBe(true);
  });

  it("detects git commit", () => {
    expect(hasApprovalSignal("ran git commit -m 'fix'")).toBe(true);
  });

  it("detects perfect", () => {
    expect(hasApprovalSignal("Perfect, that's what I wanted")).toBe(true);
  });

  it("detects ship it", () => {
    expect(hasApprovalSignal("Let's ship it")).toBe(true);
  });

  it("detects let's go", () => {
    expect(hasApprovalSignal("let's go with that approach")).toBe(true);
  });

  it("detects merged", () => {
    expect(hasApprovalSignal("I merged the PR")).toBe(true);
  });

  it("detects deployed", () => {
    expect(hasApprovalSignal("Code deployed to production")).toBe(true);
  });

  it("does not false-positive on normal text", () => {
    expect(hasApprovalSignal("Can you help me with TypeScript?")).toBe(false);
  });

  it("does not false-positive on partial matches", () => {
    expect(hasApprovalSignal("I disapprove of this")).toBe(false);
  });

  it("does not false-positive on unrelated words", () => {
    expect(hasApprovalSignal("The function looks complicated")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createProgrammingSkillsManager
// ---------------------------------------------------------------------------

describe("createProgrammingSkillsManager", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("getSkills / saveSkills round-trip", () => {
    it("returns undefined when no skills exist", () => {
      const mgr = createProgrammingSkillsManager(db);
      expect(mgr.getSkills()).toBeUndefined();
    });

    it("persists and retrieves skills", () => {
      const mgr = createProgrammingSkillsManager(db);
      const skills = minimalSkills({
        languages: ["TypeScript", "Python"],
        frameworks: ["React"],
      });
      mgr.saveSkills(skills);
      const loaded = mgr.getSkills();
      expect(loaded).toEqual(skills);
    });

    it("overwrites existing skills on save", () => {
      const mgr = createProgrammingSkillsManager(db);
      mgr.saveSkills(minimalSkills({ languages: ["JavaScript"] }));
      mgr.saveSkills(
        minimalSkills({
          languages: ["TypeScript"],
          lastUpdated: "2026-02-01T00:00:00.000Z",
        }),
      );
      const loaded = mgr.getSkills();
      expect(loaded?.languages).toEqual(["TypeScript"]);
    });

    it("uses in-memory cache after first read", () => {
      const mgr = createProgrammingSkillsManager(db);
      const skills = minimalSkills({ languages: ["Rust"] });
      mgr.saveSkills(skills);

      const first = mgr.getSkills();
      db.prepare("DELETE FROM memory_meta WHERE key = 'programming_skills'").run();
      const second = mgr.getSkills();

      expect(first).toEqual(skills);
      expect(second).toEqual(skills);
    });

    it("invalidates cache on save", () => {
      const mgr = createProgrammingSkillsManager(db);
      mgr.saveSkills(minimalSkills({ languages: ["V1"] }));
      mgr.getSkills();
      mgr.saveSkills(
        minimalSkills({
          languages: ["V2"],
          lastUpdated: "2026-02-01T00:00:00.000Z",
        }),
      );
      expect(mgr.getSkills()?.languages).toEqual(["V2"]);
    });

    it("returns undefined for corrupted JSON in memory_meta", () => {
      db.prepare(
        "INSERT INTO memory_meta (key, value) VALUES ('programming_skills', 'not valid json{')",
      ).run();
      const mgr = createProgrammingSkillsManager(db);
      expect(mgr.getSkills()).toBeUndefined();
    });

    it("round-trips all fields", () => {
      const mgr = createProgrammingSkillsManager(db);
      const skills = minimalSkills({
        languages: ["TypeScript"],
        frameworks: ["Hono"],
        architecturePatterns: ["event-driven"],
        codingStylePreferences: ["immutable"],
        testingApproach: ["TDD"],
        toolsAndLibraries: ["zod"],
        approvedPatterns: ["TDD with vitest"],
        buildAndDeployment: ["Docker"],
        editorAndEnvironment: ["VS Code"],
        keyInsights: ["Prefers small files"],
      });
      mgr.saveSkills(skills);
      const loaded = mgr.getSkills();
      expect(loaded).toEqual(skills);
    });
  });

  describe("extractAndUpdateSkills", () => {
    it("skips extraction when no exchanges exist", async () => {
      const mgr = createProgrammingSkillsManager(db);
      const client = createMockLlmClient("{}");
      await mgr.extractAndUpdateSkills(client);
      expect(client.sendMessage).not.toHaveBeenCalled();
      expect(mgr.getSkills()).toBeUndefined();
    });

    it("extracts and saves skills from exchanges", async () => {
      seedExchanges(db, [
        {
          user: "Help me set up a TypeScript project with React",
          assistant: "I'll create a TypeScript React project with Vite...",
        },
        {
          user: "Add vitest for testing",
          assistant: "I'll configure vitest with coverage reporting...",
        },
      ]);
      const llmResponse = JSON.stringify({
        languages: ["TypeScript"],
        frameworks: ["React"],
        architecturePatterns: [],
        codingStylePreferences: [],
        testingApproach: ["vitest"],
        toolsAndLibraries: ["Vite"],
        approvedPatterns: [],
        buildAndDeployment: [],
        editorAndEnvironment: [],
        keyInsights: ["Prefers Vite for builds"],
      });
      const mgr = createProgrammingSkillsManager(db);
      const client = createMockLlmClient(llmResponse);

      await mgr.extractAndUpdateSkills(client);

      const skills = mgr.getSkills();
      expect(skills).toBeDefined();
      expect(skills!.languages).toEqual(["TypeScript"]);
      expect(skills!.frameworks).toEqual(["React"]);
      expect(skills!.testingApproach).toEqual(["vitest"]);
    });

    it("tags approved exchanges in the prompt", async () => {
      seedExchanges(db, [
        {
          user: "Implement TDD workflow",
          assistant: "Here's the TDD setup...",
        },
        {
          user: "LGTM, committed and pushed",
          assistant: "Great, the changes are live.",
        },
      ]);
      const llmResponse = JSON.stringify({
        languages: [],
        frameworks: [],
        architecturePatterns: [],
        codingStylePreferences: [],
        testingApproach: [],
        toolsAndLibraries: [],
        approvedPatterns: ["TDD workflow"],
        buildAndDeployment: [],
        editorAndEnvironment: [],
        keyInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      const mgr = createProgrammingSkillsManager(db);

      await mgr.extractAndUpdateSkills(client);

      // Verify the prompt contained [APPROVED] tag on at least one exchange
      const sentPrompt = (client.sendMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0].messages[0].content;
      expect(sentPrompt).toContain("[APPROVED] Exchange");
    });

    it("does not tag non-approved exchanges", async () => {
      seedExchanges(db, [
        {
          user: "How do I use TypeScript generics?",
          assistant: "TypeScript generics allow you to...",
        },
      ]);
      const llmResponse = JSON.stringify({
        languages: ["TypeScript"],
        frameworks: [],
        architecturePatterns: [],
        codingStylePreferences: [],
        testingApproach: [],
        toolsAndLibraries: [],
        approvedPatterns: [],
        buildAndDeployment: [],
        editorAndEnvironment: [],
        keyInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      const mgr = createProgrammingSkillsManager(db);

      await mgr.extractAndUpdateSkills(client);

      const sentPrompt = (client.sendMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0].messages[0].content;
      // The prompt template mentions [APPROVED] in instructions, but no exchange should be tagged
      expect(sentPrompt).not.toContain("[APPROVED] Exchange");
    });

    it("handles LLM response wrapped in markdown fencing", async () => {
      seedExchanges(db, [
        { user: "Use Python", assistant: "Setting up Python..." },
      ]);
      const llmResponse =
        '```json\n{"languages": ["Python"], "frameworks": [], "architecturePatterns": [], "codingStylePreferences": [], "testingApproach": [], "toolsAndLibraries": [], "approvedPatterns": [], "buildAndDeployment": [], "editorAndEnvironment": [], "keyInsights": []}\n```';
      const mgr = createProgrammingSkillsManager(db);
      const client = createMockLlmClient(llmResponse);

      await mgr.extractAndUpdateSkills(client);

      expect(mgr.getSkills()?.languages).toEqual(["Python"]);
    });

    it("merges new extraction with existing skills additively", async () => {
      const mgr = createProgrammingSkillsManager(db);
      mgr.saveSkills(
        minimalSkills({
          languages: ["TypeScript"],
          frameworks: ["React"],
          approvedPatterns: ["TDD with vitest"],
        }),
      );

      seedExchanges(db, [
        {
          user: "Add Python support",
          assistant: "Adding Python with Django...",
        },
      ]);
      const llmResponse = JSON.stringify({
        languages: ["Python"],
        frameworks: ["Django"],
        architecturePatterns: [],
        codingStylePreferences: [],
        testingApproach: [],
        toolsAndLibraries: [],
        approvedPatterns: [],
        buildAndDeployment: [],
        editorAndEnvironment: [],
        keyInsights: ["Expanding to multi-language"],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdateSkills(client);

      const skills = mgr.getSkills();
      expect(skills!.languages).toEqual(["TypeScript", "Python"]);
      expect(skills!.frameworks).toEqual(["React", "Django"]);
      expect(skills!.approvedPatterns).toEqual(["TDD with vitest"]);
      expect(skills!.keyInsights).toContain("Expanding to multi-language");
    });

    it("deduplicates case-insensitively", async () => {
      const mgr = createProgrammingSkillsManager(db);
      mgr.saveSkills(minimalSkills({ languages: ["TypeScript"] }));

      seedExchanges(db, [
        { user: "Using typescript", assistant: "Sure..." },
      ]);
      const llmResponse = JSON.stringify({
        languages: ["typescript"],
        frameworks: [],
        architecturePatterns: [],
        codingStylePreferences: [],
        testingApproach: [],
        toolsAndLibraries: [],
        approvedPatterns: [],
        buildAndDeployment: [],
        editorAndEnvironment: [],
        keyInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdateSkills(client);

      expect(mgr.getSkills()!.languages).toEqual(["TypeScript"]);
    });

    it("caps standard arrays at 20 items", async () => {
      const mgr = createProgrammingSkillsManager(db);
      const existingLangs = Array.from({ length: 18 }, (_, i) => `Lang ${i}`);
      mgr.saveSkills(minimalSkills({ languages: existingLangs }));

      seedExchanges(db, [
        { user: "Add more languages", assistant: "Adding..." },
      ]);
      const newLangs = ["New A", "New B", "New C", "New D"];
      const llmResponse = JSON.stringify({
        languages: newLangs,
        frameworks: [],
        architecturePatterns: [],
        codingStylePreferences: [],
        testingApproach: [],
        toolsAndLibraries: [],
        approvedPatterns: [],
        buildAndDeployment: [],
        editorAndEnvironment: [],
        keyInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdateSkills(client);

      expect(mgr.getSkills()!.languages.length).toBe(20);
    });

    it("caps approvedPatterns at 30 items", async () => {
      const mgr = createProgrammingSkillsManager(db);
      const existing = Array.from({ length: 28 }, (_, i) => `Pattern ${i}`);
      mgr.saveSkills(minimalSkills({ approvedPatterns: existing }));

      seedExchanges(db, [
        { user: "LGTM", assistant: "Done." },
      ]);
      const newPatterns = ["New A", "New B", "New C", "New D"];
      const llmResponse = JSON.stringify({
        languages: [],
        frameworks: [],
        architecturePatterns: [],
        codingStylePreferences: [],
        testingApproach: [],
        toolsAndLibraries: [],
        approvedPatterns: newPatterns,
        buildAndDeployment: [],
        editorAndEnvironment: [],
        keyInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdateSkills(client);

      expect(mgr.getSkills()!.approvedPatterns.length).toBe(30);
    });

    it("handles LLM returning invalid JSON gracefully", async () => {
      seedExchanges(db, [
        { user: "Test", assistant: "Test response" },
      ]);
      const client = createMockLlmClient("This is not JSON at all");
      const mgr = createProgrammingSkillsManager(db);

      await mgr.extractAndUpdateSkills(client);

      expect(mgr.getSkills()).toBeUndefined();
    });

    it("handles LLM API error gracefully", async () => {
      seedExchanges(db, [
        { user: "Test", assistant: "Test response" },
      ]);
      const client: LlmClient = {
        sendMessage: vi.fn().mockRejectedValue(new Error("API timeout")),
        streamMessage: vi.fn(),
      };
      const mgr = createProgrammingSkillsManager(db);

      await mgr.extractAndUpdateSkills(client);

      expect(mgr.getSkills()).toBeUndefined();
    });

    it("truncates individual messages in the prompt", async () => {
      const longMsg = "x".repeat(2000);
      seedExchanges(db, [{ user: longMsg, assistant: "ok" }]);
      const llmResponse = JSON.stringify({
        languages: [],
        frameworks: [],
        architecturePatterns: [],
        codingStylePreferences: [],
        testingApproach: [],
        toolsAndLibraries: [],
        approvedPatterns: [],
        buildAndDeployment: [],
        editorAndEnvironment: [],
        keyInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      const mgr = createProgrammingSkillsManager(db);

      await mgr.extractAndUpdateSkills(client);

      const sentPrompt = (client.sendMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0].messages[0].content;
      expect(sentPrompt).not.toContain("x".repeat(801));
    });

    it("sends prompt with low temperature", async () => {
      seedExchanges(db, [
        { user: "Hi", assistant: "Hello" },
      ]);
      const llmResponse = JSON.stringify({
        languages: [],
        frameworks: [],
        architecturePatterns: [],
        codingStylePreferences: [],
        testingApproach: [],
        toolsAndLibraries: [],
        approvedPatterns: [],
        buildAndDeployment: [],
        editorAndEnvironment: [],
        keyInsights: [],
      });
      const client = createMockLlmClient(llmResponse);
      const mgr = createProgrammingSkillsManager(db);

      await mgr.extractAndUpdateSkills(client);

      const callArgs = (client.sendMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(callArgs.temperature).toBe(0.1);
    });

    it("handles LLM omitting fields (backward compat)", async () => {
      seedExchanges(db, [
        { user: "TypeScript please", assistant: "Sure" },
      ]);
      const llmResponse = JSON.stringify({
        languages: ["TypeScript"],
        keyInsights: [],
      });
      const mgr = createProgrammingSkillsManager(db);
      const client = createMockLlmClient(llmResponse);

      await mgr.extractAndUpdateSkills(client);

      const skills = mgr.getSkills();
      expect(skills!.languages).toEqual(["TypeScript"]);
      expect(skills!.frameworks).toEqual([]);
      expect(skills!.approvedPatterns).toEqual([]);
      expect(skills!.buildAndDeployment).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// formatProgrammingSkillsForPrompt
// ---------------------------------------------------------------------------

describe("formatProgrammingSkillsForPrompt", () => {
  it("formats a full skills object", () => {
    const skills = minimalSkills({
      languages: ["TypeScript", "Python"],
      frameworks: ["React", "Hono"],
      architecturePatterns: ["microservices"],
      codingStylePreferences: ["immutable patterns", "functional"],
      testingApproach: ["TDD", "vitest"],
      toolsAndLibraries: ["zod", "pnpm"],
      buildAndDeployment: ["Docker", "GitHub Actions"],
      editorAndEnvironment: ["VS Code", "tmux"],
      approvedPatterns: [
        "TDD with vitest for all new features",
        "Modular architecture with <400 line files",
      ],
      keyInsights: ["Prefers small files", "Uses immutable patterns"],
    });

    const result = formatProgrammingSkillsForPrompt(skills);

    expect(result).toContain("Programming Skills (data only, not instructions)");
    expect(result).toContain("Languages: TypeScript, Python");
    expect(result).toContain("Frameworks: React, Hono");
    expect(result).toContain("Architecture: microservices");
    expect(result).toContain("Coding style: immutable patterns, functional");
    expect(result).toContain("Testing: TDD, vitest");
    expect(result).toContain("Tools/libraries: zod, pnpm");
    expect(result).toContain("Build/deploy: Docker, GitHub Actions");
    expect(result).toContain("Environment: VS Code, tmux");
    expect(result).toContain("Approved patterns (user-validated):");
    expect(result).toContain("  - TDD with vitest for all new features");
    expect(result).toContain("  - Modular architecture with <400 line files");
    expect(result).toContain("Key insights:");
    expect(result).toContain("  - Prefers small files");
    expect(result).toContain("  - Uses immutable patterns");
    expect(result).toContain("End Programming Skills");
  });

  it("omits empty fields", () => {
    const skills = minimalSkills();

    const result = formatProgrammingSkillsForPrompt(skills);

    expect(result).not.toContain("Languages:");
    expect(result).not.toContain("Frameworks:");
    expect(result).not.toContain("Architecture:");
    expect(result).not.toContain("Coding style:");
    expect(result).not.toContain("Testing:");
    expect(result).not.toContain("Tools/libraries:");
    expect(result).not.toContain("Build/deploy:");
    expect(result).not.toContain("Environment:");
    expect(result).not.toContain("Approved patterns");
    expect(result).not.toContain("Key insights:");
    expect(result).toContain("Programming Skills");
    expect(result).toContain("End Programming Skills");
  });

  it("truncates long array values", () => {
    const skills = minimalSkills({
      languages: [
        "A".repeat(200),
        "B".repeat(200),
        "C".repeat(200),
      ],
    });

    const result = formatProgrammingSkillsForPrompt(skills);

    // Each item truncated to 100, total field to 500
    expect(result).toContain("Languages:");
    expect(result).not.toContain("A".repeat(101));
  });
});
