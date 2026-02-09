import { createHash, randomUUID } from "node:crypto";
import type { SqliteDb } from "./sqlite.js";
import { withTransaction } from "./sqlite.js";
import type {
  GccMemoryType,
  GccCommit,
  GccBranch,
  GccCommitParams,
  GccMergeResult,
  GccConflict,
  GccLogEntry,
  GccBranchSummary,
  GccDelta,
  GccConfidence,
} from "./gcc-types.js";
import { createLogger } from "../logging.js";

const log = createLogger("gcc-store");

const DEFAULT_BRANCH = "main";

function computeHash(data: string): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

function computeDelta(
  oldSnapshot: Record<string, unknown>,
  newSnapshot: Record<string, unknown>,
): GccDelta {
  const added: Record<string, string[]> = {};
  const removed: Record<string, string[]> = {};

  const allKeys = new Set([...Object.keys(oldSnapshot), ...Object.keys(newSnapshot)]);

  for (const key of allKeys) {
    if (key === "lastUpdated") continue;

    const oldVal = oldSnapshot[key];
    const newVal = newSnapshot[key];

    if (Array.isArray(oldVal) && Array.isArray(newVal)) {
      const oldSet = new Set(oldVal.map((v) => String(v).toLowerCase()));
      const newSet = new Set(newVal.map((v) => String(v).toLowerCase()));

      const addedItems = (newVal as string[]).filter(
        (v) => !oldSet.has(String(v).toLowerCase()),
      );
      const removedItems = (oldVal as string[]).filter(
        (v) => !newSet.has(String(v).toLowerCase()),
      );

      if (addedItems.length > 0) added[key] = addedItems;
      if (removedItems.length > 0) removed[key] = removedItems;
    } else if (Array.isArray(newVal) && !Array.isArray(oldVal)) {
      if (newVal.length > 0) added[key] = newVal as string[];
    } else if (Array.isArray(oldVal) && !Array.isArray(newVal)) {
      if (oldVal.length > 0) removed[key] = oldVal as string[];
    }
  }

  return { added, removed };
}

function countDeltaItems(delta: GccDelta): { added: number; removed: number } {
  let addedCount = 0;
  let removedCount = 0;
  for (const items of Object.values(delta.added)) {
    addedCount += items.length;
  }
  for (const items of Object.values(delta.removed)) {
    removedCount += items.length;
  }
  return { added: addedCount, removed: removedCount };
}

export type GccStore = {
  commit: (params: GccCommitParams) => GccCommit;
  createBranch: (type: GccMemoryType, name: string, from?: string) => GccBranch;
  merge: (type: GccMemoryType, sourceBranch: string, targetBranch?: string) => GccMergeResult;
  switchBranch: (type: GccMemoryType, name: string) => GccBranch | undefined;
  log: (type: GccMemoryType, branch?: string, limit?: number) => GccLogEntry[];
  rollback: (type: GccMemoryType, toHash: string) => GccCommit | undefined;
  getHeadSnapshot: (type: GccMemoryType, branch?: string) => Record<string, unknown> | undefined;
  getHeadCommit: (type: GccMemoryType, branch?: string) => GccCommit | undefined;
  listBranches: (type: GccMemoryType) => GccBranchSummary[];
  deleteBranch: (type: GccMemoryType, name: string) => boolean;
  migrateFromLegacy: (type: GccMemoryType, data: Record<string, unknown>) => GccCommit;
};

export function createGccStore(db: SqliteDb): GccStore {
  const getBranchStmt = db.prepare(
    "SELECT id, memory_type, branch_name, head_commit_hash, created_at FROM gcc_branches WHERE memory_type = ? AND branch_name = ?",
  );

  const upsertBranchStmt = db.prepare(
    "INSERT INTO gcc_branches (memory_type, branch_name, head_commit_hash) VALUES (?, ?, ?) ON CONFLICT(memory_type, branch_name) DO UPDATE SET head_commit_hash = excluded.head_commit_hash",
  );

  const insertCommitStmt = db.prepare(
    "INSERT INTO gcc_commits (hash, memory_type, branch_name, parent_hash, delta, snapshot, message, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );

  const getCommitStmt = db.prepare(
    "SELECT hash, memory_type, branch_name, parent_hash, delta, snapshot, message, confidence, created_at FROM gcc_commits WHERE hash = ?",
  );

  const getCommitsByBranchStmt = db.prepare(
    "SELECT hash, parent_hash, message, confidence, created_at, delta FROM gcc_commits WHERE memory_type = ? AND branch_name = ? ORDER BY seq DESC LIMIT ?",
  );

  const countCommitsStmt = db.prepare(
    "SELECT COUNT(*) as count FROM gcc_commits WHERE memory_type = ? AND branch_name = ?",
  );

  const listBranchesStmt = db.prepare(
    "SELECT branch_name, head_commit_hash, created_at FROM gcc_branches WHERE memory_type = ?",
  );

  const deleteBranchStmt = db.prepare(
    "DELETE FROM gcc_branches WHERE memory_type = ? AND branch_name = ?",
  );

  const deleteBranchCommitsStmt = db.prepare(
    "DELETE FROM gcc_commits WHERE memory_type = ? AND branch_name = ?",
  );

  function parseBranchRow(row: Record<string, unknown>): GccBranch {
    return {
      id: row.id as number,
      memoryType: row.memory_type as GccMemoryType,
      branchName: row.branch_name as string,
      headCommitHash: (row.head_commit_hash as string) || null,
      createdAt: row.created_at as string,
    };
  }

  function parseCommitRow(row: Record<string, unknown>): GccCommit {
    let delta: GccDelta;
    let snapshot: Record<string, unknown>;
    try {
      delta = JSON.parse(row.delta as string) as GccDelta;
    } catch {
      log.warn(`Corrupt delta JSON in commit ${row.hash}, using empty delta`);
      delta = { added: {}, removed: {} };
    }
    try {
      snapshot = JSON.parse(row.snapshot as string) as Record<string, unknown>;
    } catch {
      log.warn(`Corrupt snapshot JSON in commit ${row.hash}, using empty snapshot`);
      snapshot = {};
    }
    return {
      hash: row.hash as string,
      memoryType: row.memory_type as GccMemoryType,
      branchName: row.branch_name as string,
      parentHash: (row.parent_hash as string) || null,
      delta,
      snapshot,
      message: row.message as string,
      confidence: row.confidence as GccConfidence,
      createdAt: row.created_at as string,
    };
  }

  function ensureBranch(type: GccMemoryType, name: string): GccBranch {
    const existing = getBranchStmt.get(type, name) as Record<string, unknown> | undefined;
    if (existing) return parseBranchRow(existing);

    upsertBranchStmt.run(type, name, null);
    const created = getBranchStmt.get(type, name) as Record<string, unknown>;
    return parseBranchRow(created);
  }

  function getHeadCommitForBranch(type: GccMemoryType, branchName: string): GccCommit | undefined {
    const branch = getBranchStmt.get(type, branchName) as Record<string, unknown> | undefined;
    if (!branch || !branch.head_commit_hash) return undefined;

    const row = getCommitStmt.get(branch.head_commit_hash as string) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return parseCommitRow(row);
  }

  const commit = (params: GccCommitParams): GccCommit => {
    return withTransaction(db, () => {
      const branchName = params.branchName ?? DEFAULT_BRANCH;
      ensureBranch(params.memoryType, branchName);

      const headCommit = getHeadCommitForBranch(params.memoryType, branchName);
      const parentHash = headCommit?.hash ?? null;
      const oldSnapshot = headCommit?.snapshot ?? {};

      const delta = computeDelta(oldSnapshot, params.snapshot);
      const hashInput = `${params.memoryType}:${branchName}:${parentHash ?? "root"}:${randomUUID()}`;
      const hash = computeHash(hashInput);

      insertCommitStmt.run(
        hash,
        params.memoryType,
        branchName,
        parentHash,
        JSON.stringify(delta),
        JSON.stringify(params.snapshot),
        params.message,
        params.confidence,
        new Date().toISOString(),
      );

      upsertBranchStmt.run(params.memoryType, branchName, hash);

      const commitRow = getCommitStmt.get(hash) as Record<string, unknown>;
      return parseCommitRow(commitRow);
    });
  };

  const createBranch = (type: GccMemoryType, name: string, from?: string): GccBranch => {
    return withTransaction(db, () => {
      const sourceBranch = from ?? DEFAULT_BRANCH;
      const sourceHead = getHeadCommitForBranch(type, sourceBranch);

      upsertBranchStmt.run(type, name, sourceHead?.hash ?? null);

      // Copy the head commit to the new branch if one exists
      if (sourceHead) {
        const newHashInput = `${type}:${name}:${sourceHead.hash}:${randomUUID()}`;
        const newHash = computeHash(newHashInput);
        insertCommitStmt.run(
          newHash,
          type,
          name,
          null,
          JSON.stringify(sourceHead.delta),
          JSON.stringify(sourceHead.snapshot),
          `Branch '${name}' created from '${sourceBranch}'`,
          sourceHead.confidence,
          new Date().toISOString(),
        );
        upsertBranchStmt.run(type, name, newHash);
      }

      const row = getBranchStmt.get(type, name) as Record<string, unknown>;
      return parseBranchRow(row);
    });
  };

  const merge = (
    type: GccMemoryType,
    sourceBranch: string,
    targetBranch?: string,
  ): GccMergeResult => {
    return withTransaction(db, () => {
      const target = targetBranch ?? DEFAULT_BRANCH;
      const sourceHead = getHeadCommitForBranch(type, sourceBranch);
      const targetHead = getHeadCommitForBranch(type, target);

      if (!sourceHead) {
        return { success: false, commitHash: null, conflicts: [] };
      }

      const sourceSnapshot = sourceHead.snapshot;
      const targetSnapshot = targetHead?.snapshot ?? {};

      // Union-based merge for arrays
      const merged: Record<string, unknown> = { ...targetSnapshot };
      const conflicts: GccConflict[] = [];

      for (const [key, sourceVal] of Object.entries(sourceSnapshot)) {
        if (key === "lastUpdated") continue;

        const targetVal = targetSnapshot[key];

        if (Array.isArray(sourceVal) && (Array.isArray(targetVal) || targetVal === undefined)) {
          const targetArr = (targetVal as string[] | undefined) ?? [];
          const seen = new Set<string>();
          const unionResult: string[] = [];
          for (const item of [...targetArr, ...(sourceVal as string[])]) {
            const normalized = String(item).toLowerCase().trim();
            if (normalized && !seen.has(normalized)) {
              seen.add(normalized);
              unionResult.push(item);
            }
          }
          merged[key] = unionResult;
        } else if (typeof sourceVal === "string" && typeof targetVal === "string") {
          if (sourceVal !== targetVal) {
            conflicts.push({
              field: key,
              sourceValues: [sourceVal],
              targetValues: [targetVal],
            });
            // Keep target value on conflict
          }
        } else if (targetVal === undefined) {
          merged[key] = sourceVal;
        }
      }

      merged.lastUpdated = new Date().toISOString();

      const mergeCommit = commit({
        memoryType: type,
        branchName: target,
        snapshot: merged,
        message: `Merge '${sourceBranch}' into '${target}'`,
        confidence: sourceHead.confidence,
      });

      return {
        success: true,
        commitHash: mergeCommit.hash,
        conflicts,
      };
    });
  };

  const switchBranch = (type: GccMemoryType, name: string): GccBranch | undefined => {
    const row = getBranchStmt.get(type, name) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return parseBranchRow(row);
  };

  const logEntries = (type: GccMemoryType, branch?: string, limit?: number): GccLogEntry[] => {
    const branchName = branch ?? DEFAULT_BRANCH;
    const rows = getCommitsByBranchStmt.all(type, branchName, limit ?? 50) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      let delta: GccDelta;
      try {
        delta = JSON.parse(row.delta as string) as GccDelta;
      } catch {
        log.warn(`Corrupt delta JSON in log entry ${row.hash}, using empty delta`);
        delta = { added: {}, removed: {} };
      }
      const counts = countDeltaItems(delta);
      return {
        hash: row.hash as string,
        parentHash: (row.parent_hash as string) || null,
        message: row.message as string,
        confidence: row.confidence as GccConfidence,
        createdAt: row.created_at as string,
        deltaAdded: counts.added,
        deltaRemoved: counts.removed,
      };
    });
  };

  const rollback = (type: GccMemoryType, toHash: string): GccCommit | undefined => {
    return withTransaction(db, () => {
      const targetRow = getCommitStmt.get(toHash) as Record<string, unknown> | undefined;
      if (!targetRow) return undefined;

      const targetCommit = parseCommitRow(targetRow);
      if (targetCommit.memoryType !== type) return undefined;

      // Create a new commit that restores the old snapshot
      const rollbackCommit = commit({
        memoryType: type,
        branchName: targetCommit.branchName,
        snapshot: targetCommit.snapshot,
        message: `Rollback to ${toHash}`,
        confidence: targetCommit.confidence,
      });

      return rollbackCommit;
    });
  };

  const getHeadSnapshot = (
    type: GccMemoryType,
    branch?: string,
  ): Record<string, unknown> | undefined => {
    const branchName = branch ?? DEFAULT_BRANCH;
    const headCommit = getHeadCommitForBranch(type, branchName);
    if (!headCommit) return undefined;
    return structuredClone(headCommit.snapshot);
  };

  const getHeadCommit = (
    type: GccMemoryType,
    branch?: string,
  ): GccCommit | undefined => {
    const branchName = branch ?? DEFAULT_BRANCH;
    return getHeadCommitForBranch(type, branchName);
  };

  const listBranchesForType = (type: GccMemoryType): GccBranchSummary[] => {
    const rows = listBranchesStmt.all(type) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const count = countCommitsStmt.get(type, row.branch_name as string) as { count: number };
      return {
        branchName: row.branch_name as string,
        headCommitHash: (row.head_commit_hash as string) || null,
        commitCount: count.count,
        createdAt: row.created_at as string,
      };
    });
  };

  const deleteBranchFn = (type: GccMemoryType, name: string): boolean => {
    if (name === DEFAULT_BRANCH) {
      log.warn("Cannot delete the main branch");
      return false;
    }
    return withTransaction(db, () => {
      deleteBranchCommitsStmt.run(type, name);
      const result = deleteBranchStmt.run(type, name);
      return result.changes > 0;
    });
  };

  const migrateFromLegacy = (
    type: GccMemoryType,
    data: Record<string, unknown>,
  ): GccCommit => {
    return commit({
      memoryType: type,
      branchName: DEFAULT_BRANCH,
      snapshot: data,
      message: "Migrated from legacy memory_meta storage",
      confidence: "MEDIUM_CONFIDENCE",
    });
  };

  return {
    commit,
    createBranch,
    merge,
    switchBranch,
    log: logEntries,
    rollback,
    getHeadSnapshot,
    getHeadCommit,
    listBranches: listBranchesForType,
    deleteBranch: deleteBranchFn,
    migrateFromLegacy,
  };
}
