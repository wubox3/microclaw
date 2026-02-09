export type GccMemoryType = "programming_skills" | "programming_planning" | "event_planning" | "workflow" | "tasks";

export type GccConfidence = "HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE" | "LOW_CONFIDENCE";

export type GccDelta = {
  added: Record<string, string[]>;
  removed: Record<string, string[]>;
};

export type GccCommit = {
  hash: string;
  memoryType: GccMemoryType;
  branchName: string;
  parentHash: string | null;
  delta: GccDelta;
  snapshot: Record<string, unknown>;
  message: string;
  confidence: GccConfidence;
  createdAt: string;
};

export type GccBranch = {
  id: number;
  memoryType: GccMemoryType;
  branchName: string;
  headCommitHash: string | null;
  createdAt: string;
};

export type GccCommitParams = {
  memoryType: GccMemoryType;
  branchName?: string;
  snapshot: Record<string, unknown>;
  message: string;
  confidence: GccConfidence;
};

export type GccMergeResult = {
  success: boolean;
  commitHash: string | null;
  conflicts: GccConflict[];
};

export type GccConflict = {
  field: string;
  sourceValues: string[];
  targetValues: string[];
};

export type GccLogEntry = {
  hash: string;
  parentHash: string | null;
  message: string;
  confidence: GccConfidence;
  createdAt: string;
  deltaAdded: number;
  deltaRemoved: number;
};

export type GccBranchSummary = {
  branchName: string;
  headCommitHash: string | null;
  commitCount: number;
  createdAt: string;
};
