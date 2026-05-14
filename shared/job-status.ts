export const JOB_STATUS = {
  PENDING: "pending",
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  ERROR: "error",
  CANCELLED: "cancelled",
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS] | string;

export const TERMINAL_JOB_STATUSES = new Set<string>([
  JOB_STATUS.COMPLETED,
  JOB_STATUS.FAILED,
  JOB_STATUS.ERROR,
  JOB_STATUS.CANCELLED,
]);

export const SUCCESSFUL_JOB_STATUSES = new Set<string>([
  JOB_STATUS.COMPLETED,
]);

export const ACTIVE_JOB_STATUSES = new Set<string>([
  JOB_STATUS.PENDING,
  JOB_STATUS.QUEUED,
  JOB_STATUS.RUNNING,
]);

export function isTerminalJobStatus(status?: JobStatus | null): boolean {
  return !!status && TERMINAL_JOB_STATUSES.has(String(status));
}

export function isSuccessfulJobStatus(status?: JobStatus | null): boolean {
  return !!status && SUCCESSFUL_JOB_STATUSES.has(String(status));
}

export function isActiveJobStatus(status?: JobStatus | null): boolean {
  return !!status && ACTIVE_JOB_STATUSES.has(String(status));
}

export function normalizeJobStatus(status?: JobStatus | null): JobStatus {
  const value = String(status || "").trim().toLowerCase();
  if (value === "queued") return JOB_STATUS.PENDING;
  if (value === "error") return JOB_STATUS.FAILED;
  return value || JOB_STATUS.PENDING;
}
