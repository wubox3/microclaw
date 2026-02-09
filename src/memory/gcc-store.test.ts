import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createGccStore, type GccStore } from "./gcc-store.js";
import { MEMORY_SCHEMA, GCC_SCHEMA } from "./memory-schema.js";

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(MEMORY_SCHEMA);
  db.exec(GCC_SCHEMA);
  return db;
}

function makeSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    languages: ["TypeScript"],
    frameworks: ["React"],
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

describe("GccStore", () => {
  let db: DatabaseSync;
  let store: GccStore;

  beforeEach(() => {
    db = createTestDb();
    store = createGccStore(db);
  });

  afterEach(() => {
    db.close();
  });

  // -----------------------------------------------------------------------
  // commit
  // -----------------------------------------------------------------------
  describe("commit", () => {
    it("creates a first commit on the main branch", () => {
      const snapshot = makeSnapshot();
      const result = store.commit({
        memoryType: "programming_skills",
        snapshot,
        message: "Initial commit",
        confidence: "HIGH_CONFIDENCE",
      });

      expect(result.hash).toBeDefined();
      expect(result.hash.length).toBe(16);
      expect(result.memoryType).toBe("programming_skills");
      expect(result.branchName).toBe("main");
      expect(result.parentHash).toBeNull();
      expect(result.message).toBe("Initial commit");
      expect(result.confidence).toBe("HIGH_CONFIDENCE");
      expect(result.snapshot).toEqual(snapshot);
    });

    it("chains commits with parent hashes", () => {
      const c1 = store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"] }),
        message: "First",
        confidence: "HIGH_CONFIDENCE",
      });

      const c2 = store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript", "Python"] }),
        message: "Second",
        confidence: "MEDIUM_CONFIDENCE",
      });

      expect(c2.parentHash).toBe(c1.hash);
    });

    it("computes delta between consecutive commits", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"], frameworks: ["React"] }),
        message: "First",
        confidence: "HIGH_CONFIDENCE",
      });

      const c2 = store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript", "Python"], frameworks: [] }),
        message: "Second",
        confidence: "MEDIUM_CONFIDENCE",
      });

      expect(c2.delta.added.languages).toEqual(["Python"]);
      expect(c2.delta.removed.frameworks).toEqual(["React"]);
    });

    it("stores empty delta when snapshots are identical", () => {
      const snapshot = makeSnapshot({ languages: ["TypeScript"] });
      store.commit({
        memoryType: "programming_skills",
        snapshot,
        message: "First",
        confidence: "HIGH_CONFIDENCE",
      });

      const c2 = store.commit({
        memoryType: "programming_skills",
        snapshot: { ...snapshot },
        message: "No changes",
        confidence: "LOW_CONFIDENCE",
      });

      expect(Object.keys(c2.delta.added)).toHaveLength(0);
      expect(Object.keys(c2.delta.removed)).toHaveLength(0);
    });

    it("commits to a specified branch", () => {
      store.createBranch("programming_skills", "experiment");

      const result = store.commit({
        memoryType: "programming_skills",
        branchName: "experiment",
        snapshot: makeSnapshot(),
        message: "On experiment branch",
        confidence: "LOW_CONFIDENCE",
      });

      expect(result.branchName).toBe("experiment");
    });

    it("creates branch implicitly if it does not exist", () => {
      const result = store.commit({
        memoryType: "programming_skills",
        branchName: "new-branch",
        snapshot: makeSnapshot(),
        message: "Auto-created branch",
        confidence: "MEDIUM_CONFIDENCE",
      });

      expect(result.branchName).toBe("new-branch");
      const branches = store.listBranches("programming_skills");
      expect(branches.some((b) => b.branchName === "new-branch")).toBe(true);
    });

    it("isolates commits across memory types", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"] }),
        message: "Skills commit",
        confidence: "HIGH_CONFIDENCE",
      });

      store.commit({
        memoryType: "event_planning",
        snapshot: { preferredTimes: ["morning"], lastUpdated: new Date().toISOString() },
        message: "Events commit",
        confidence: "MEDIUM_CONFIDENCE",
      });

      const skillsLog = store.log("programming_skills");
      const eventsLog = store.log("event_planning");

      expect(skillsLog).toHaveLength(1);
      expect(eventsLog).toHaveLength(1);
      expect(skillsLog[0].message).toBe("Skills commit");
      expect(eventsLog[0].message).toBe("Events commit");
    });
  });

  // -----------------------------------------------------------------------
  // getHeadSnapshot / getHeadCommit
  // -----------------------------------------------------------------------
  describe("getHeadSnapshot", () => {
    it("returns undefined when no commits exist", () => {
      expect(store.getHeadSnapshot("programming_skills")).toBeUndefined();
    });

    it("returns the latest snapshot", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"] }),
        message: "V1",
        confidence: "HIGH_CONFIDENCE",
      });

      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript", "Python"] }),
        message: "V2",
        confidence: "MEDIUM_CONFIDENCE",
      });

      const head = store.getHeadSnapshot("programming_skills");
      expect(head).toBeDefined();
      expect((head as Record<string, unknown>).languages).toEqual(["TypeScript", "Python"]);
    });

    it("returns a cloned snapshot (no mutation leaks)", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"] }),
        message: "V1",
        confidence: "HIGH_CONFIDENCE",
      });

      const head1 = store.getHeadSnapshot("programming_skills");
      (head1 as Record<string, unknown>).languages = ["MUTATED"];

      const head2 = store.getHeadSnapshot("programming_skills");
      expect((head2 as Record<string, unknown>).languages).toEqual(["TypeScript"]);
    });

    it("reads from a specific branch", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"] }),
        message: "Main commit",
        confidence: "HIGH_CONFIDENCE",
      });

      store.createBranch("programming_skills", "exp");
      store.commit({
        memoryType: "programming_skills",
        branchName: "exp",
        snapshot: makeSnapshot({ languages: ["Rust"] }),
        message: "Exp commit",
        confidence: "LOW_CONFIDENCE",
      });

      const mainHead = store.getHeadSnapshot("programming_skills", "main");
      const expHead = store.getHeadSnapshot("programming_skills", "exp");

      expect((mainHead as Record<string, unknown>).languages).toEqual(["TypeScript"]);
      expect((expHead as Record<string, unknown>).languages).toEqual(["Rust"]);
    });
  });

  describe("getHeadCommit", () => {
    it("returns undefined when no commits exist", () => {
      expect(store.getHeadCommit("programming_skills")).toBeUndefined();
    });

    it("returns the latest commit object", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot(),
        message: "First",
        confidence: "HIGH_CONFIDENCE",
      });

      const head = store.getHeadCommit("programming_skills");
      expect(head).toBeDefined();
      expect(head!.message).toBe("First");
    });
  });

  // -----------------------------------------------------------------------
  // createBranch
  // -----------------------------------------------------------------------
  describe("createBranch", () => {
    it("creates a branch from main", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"] }),
        message: "Initial",
        confidence: "HIGH_CONFIDENCE",
      });

      const branch = store.createBranch("programming_skills", "feature-x");
      expect(branch.branchName).toBe("feature-x");
      expect(branch.headCommitHash).toBeDefined();
    });

    it("creates a branch from empty main", () => {
      const branch = store.createBranch("programming_skills", "empty-fork");
      expect(branch.branchName).toBe("empty-fork");
      expect(branch.headCommitHash).toBeNull();
    });

    it("creates a branch from another branch", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"] }),
        message: "Main V1",
        confidence: "HIGH_CONFIDENCE",
      });

      store.createBranch("programming_skills", "dev");
      store.commit({
        memoryType: "programming_skills",
        branchName: "dev",
        snapshot: makeSnapshot({ languages: ["TypeScript", "Rust"] }),
        message: "Dev V1",
        confidence: "MEDIUM_CONFIDENCE",
      });

      const featureBranch = store.createBranch("programming_skills", "feature", "dev");
      const snapshot = store.getHeadSnapshot("programming_skills", "feature");
      expect((snapshot as Record<string, unknown>).languages).toEqual(["TypeScript", "Rust"]);
    });
  });

  // -----------------------------------------------------------------------
  // merge
  // -----------------------------------------------------------------------
  describe("merge", () => {
    it("merges source branch into main with union semantics", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"], frameworks: ["React"] }),
        message: "Main V1",
        confidence: "HIGH_CONFIDENCE",
      });

      store.createBranch("programming_skills", "exp");
      store.commit({
        memoryType: "programming_skills",
        branchName: "exp",
        snapshot: makeSnapshot({ languages: ["TypeScript", "Python"], frameworks: ["Django"] }),
        message: "Exp V1",
        confidence: "MEDIUM_CONFIDENCE",
      });

      const result = store.merge("programming_skills", "exp");
      expect(result.success).toBe(true);
      expect(result.commitHash).toBeDefined();

      const merged = store.getHeadSnapshot("programming_skills", "main");
      const langs = (merged as Record<string, unknown>).languages as string[];
      const fws = (merged as Record<string, unknown>).frameworks as string[];
      expect(langs).toContain("TypeScript");
      expect(langs).toContain("Python");
      expect(fws).toContain("React");
      expect(fws).toContain("Django");
    });

    it("deduplicates union merge results case-insensitively", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"] }),
        message: "Main V1",
        confidence: "HIGH_CONFIDENCE",
      });

      store.createBranch("programming_skills", "exp");
      store.commit({
        memoryType: "programming_skills",
        branchName: "exp",
        snapshot: makeSnapshot({ languages: ["typescript", "Python"] }),
        message: "Exp V1",
        confidence: "MEDIUM_CONFIDENCE",
      });

      store.merge("programming_skills", "exp");
      const merged = store.getHeadSnapshot("programming_skills", "main");
      const langs = (merged as Record<string, unknown>).languages as string[];
      expect(langs).toHaveLength(2);
    });

    it("returns failure when source branch has no commits", () => {
      store.createBranch("programming_skills", "empty");
      const result = store.merge("programming_skills", "empty");
      expect(result.success).toBe(false);
    });

    it("reports string field conflicts", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: { ...makeSnapshot(), name: "Alice" },
        message: "Main",
        confidence: "HIGH_CONFIDENCE",
      });

      store.createBranch("programming_skills", "exp");
      store.commit({
        memoryType: "programming_skills",
        branchName: "exp",
        snapshot: { ...makeSnapshot(), name: "Bob" },
        message: "Exp",
        confidence: "MEDIUM_CONFIDENCE",
      });

      const result = store.merge("programming_skills", "exp");
      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].field).toBe("name");
    });
  });

  // -----------------------------------------------------------------------
  // log
  // -----------------------------------------------------------------------
  describe("log", () => {
    it("returns empty array when no commits exist", () => {
      expect(store.log("programming_skills")).toEqual([]);
    });

    it("returns commits in reverse chronological order", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"] }),
        message: "First",
        confidence: "HIGH_CONFIDENCE",
      });
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript", "Python"] }),
        message: "Second",
        confidence: "MEDIUM_CONFIDENCE",
      });

      const entries = store.log("programming_skills");
      expect(entries).toHaveLength(2);
      expect(entries[0].message).toBe("Second");
      expect(entries[1].message).toBe("First");
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        store.commit({
          memoryType: "programming_skills",
          snapshot: makeSnapshot({ languages: [`Lang${i}`] }),
          message: `Commit ${i}`,
          confidence: "HIGH_CONFIDENCE",
        });
      }

      const entries = store.log("programming_skills", "main", 3);
      expect(entries).toHaveLength(3);
    });

    it("includes delta counts", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"] }),
        message: "First",
        confidence: "HIGH_CONFIDENCE",
      });
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript", "Python", "Rust"] }),
        message: "Second",
        confidence: "MEDIUM_CONFIDENCE",
      });

      const entries = store.log("programming_skills");
      expect(entries[0].deltaAdded).toBe(2); // Python, Rust added
    });

    it("logs per-branch", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot(),
        message: "Main commit",
        confidence: "HIGH_CONFIDENCE",
      });

      store.createBranch("programming_skills", "dev");
      store.commit({
        memoryType: "programming_skills",
        branchName: "dev",
        snapshot: makeSnapshot({ languages: ["Rust"] }),
        message: "Dev commit",
        confidence: "MEDIUM_CONFIDENCE",
      });

      const mainLog = store.log("programming_skills", "main");
      const devLog = store.log("programming_skills", "dev");

      expect(mainLog).toHaveLength(1);
      // Dev has the branch-creation commit + the dev commit
      expect(devLog.length).toBeGreaterThanOrEqual(1);
      expect(devLog.some((e) => e.message === "Dev commit")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // rollback
  // -----------------------------------------------------------------------
  describe("rollback", () => {
    it("creates a new commit with old snapshot", () => {
      const c1 = store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"] }),
        message: "V1",
        confidence: "HIGH_CONFIDENCE",
      });

      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript", "Python", "Rust"] }),
        message: "V2",
        confidence: "MEDIUM_CONFIDENCE",
      });

      const rollbackResult = store.rollback("programming_skills", c1.hash);
      expect(rollbackResult).toBeDefined();
      expect(rollbackResult!.message).toBe(`Rollback to ${c1.hash}`);

      const head = store.getHeadSnapshot("programming_skills");
      expect((head as Record<string, unknown>).languages).toEqual(["TypeScript"]);
    });

    it("returns undefined for non-existent hash", () => {
      expect(store.rollback("programming_skills", "nonexistent")).toBeUndefined();
    });

    it("returns undefined for wrong memory type", () => {
      const c = store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot(),
        message: "Skills",
        confidence: "HIGH_CONFIDENCE",
      });

      expect(store.rollback("event_planning", c.hash)).toBeUndefined();
    });

    it("does not destroy intermediate commits (non-destructive)", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript"] }),
        message: "V1",
        confidence: "HIGH_CONFIDENCE",
      });

      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["TypeScript", "Python"] }),
        message: "V2",
        confidence: "MEDIUM_CONFIDENCE",
      });

      const c1Hash = store.log("programming_skills")[1].hash;
      store.rollback("programming_skills", c1Hash);

      const allEntries = store.log("programming_skills");
      expect(allEntries.length).toBe(3); // V1, V2, Rollback
    });
  });

  // -----------------------------------------------------------------------
  // listBranches / deleteBranch
  // -----------------------------------------------------------------------
  describe("listBranches", () => {
    it("returns empty array when no branches exist", () => {
      expect(store.listBranches("programming_skills")).toEqual([]);
    });

    it("lists all branches for a memory type", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot(),
        message: "Init",
        confidence: "HIGH_CONFIDENCE",
      });
      store.createBranch("programming_skills", "dev");
      store.createBranch("programming_skills", "experiment");

      const branches = store.listBranches("programming_skills");
      const names = branches.map((b) => b.branchName);
      expect(names).toContain("main");
      expect(names).toContain("dev");
      expect(names).toContain("experiment");
    });

    it("includes commit counts", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot(),
        message: "V1",
        confidence: "HIGH_CONFIDENCE",
      });
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["Rust"] }),
        message: "V2",
        confidence: "MEDIUM_CONFIDENCE",
      });

      const branches = store.listBranches("programming_skills");
      const main = branches.find((b) => b.branchName === "main");
      expect(main?.commitCount).toBe(2);
    });
  });

  describe("deleteBranch", () => {
    it("deletes a non-main branch", () => {
      store.createBranch("programming_skills", "temp");
      const result = store.deleteBranch("programming_skills", "temp");
      expect(result).toBe(true);

      const branches = store.listBranches("programming_skills");
      expect(branches.some((b) => b.branchName === "temp")).toBe(false);
    });

    it("refuses to delete the main branch", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot(),
        message: "Init",
        confidence: "HIGH_CONFIDENCE",
      });

      const result = store.deleteBranch("programming_skills", "main");
      expect(result).toBe(false);
    });

    it("returns false for non-existent branch", () => {
      const result = store.deleteBranch("programming_skills", "nonexistent");
      expect(result).toBe(false);
    });

    it("deletes associated commits", () => {
      store.createBranch("programming_skills", "temp");
      store.commit({
        memoryType: "programming_skills",
        branchName: "temp",
        snapshot: makeSnapshot(),
        message: "Temp commit",
        confidence: "LOW_CONFIDENCE",
      });

      store.deleteBranch("programming_skills", "temp");

      const entries = store.log("programming_skills", "temp");
      expect(entries).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // migrateFromLegacy
  // -----------------------------------------------------------------------
  describe("migrateFromLegacy", () => {
    it("creates an initial commit from legacy data", () => {
      const legacyData = {
        languages: ["TypeScript", "Python"],
        frameworks: ["React"],
        lastUpdated: "2026-01-01T00:00:00.000Z",
      };

      const result = store.migrateFromLegacy("programming_skills", legacyData);
      expect(result.message).toContain("Migrated from legacy");
      expect(result.confidence).toBe("MEDIUM_CONFIDENCE");

      const head = store.getHeadSnapshot("programming_skills");
      expect(head).toBeDefined();
      expect((head as Record<string, unknown>).languages).toEqual(["TypeScript", "Python"]);
    });

    it("does not overwrite existing GCC commits", () => {
      store.commit({
        memoryType: "programming_skills",
        snapshot: makeSnapshot({ languages: ["Rust"] }),
        message: "Existing",
        confidence: "HIGH_CONFIDENCE",
      });

      store.migrateFromLegacy("programming_skills", {
        languages: ["TypeScript"],
        lastUpdated: "2026-01-01T00:00:00.000Z",
      });

      // Migration creates a second commit; head should be the migration
      const head = store.getHeadSnapshot("programming_skills");
      expect((head as Record<string, unknown>).languages).toEqual(["TypeScript"]);

      // But original is still in the log
      const entries = store.log("programming_skills");
      expect(entries).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // switchBranch
  // -----------------------------------------------------------------------
  describe("switchBranch", () => {
    it("returns branch info for existing branch", () => {
      store.createBranch("programming_skills", "dev");
      const branch = store.switchBranch("programming_skills", "dev");
      expect(branch).toBeDefined();
      expect(branch!.branchName).toBe("dev");
    });

    it("returns undefined for non-existent branch", () => {
      expect(store.switchBranch("programming_skills", "nonexistent")).toBeUndefined();
    });
  });
});
