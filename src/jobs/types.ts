export type AsapJobStatus = "pending" | "running" | "done" | "failed";

export type AsapJob = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: AsapJobStatus;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: string;
};

export type AsapStore = {
  readonly version: 1;
  readonly jobs: readonly AsapJob[];
};
