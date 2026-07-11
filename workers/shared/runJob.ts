import { logWorkerJob, safeErrorSummary } from "./safeLog.ts";

export interface JobCounters {
  processed?: number;
  skipped?: number;
  failed?: number;
}

export interface JobRunResult {
  succeeded: boolean;
  processed: number;
  skipped: number;
  failed: number;
}

function toCounters(value: unknown): Required<JobCounters> {
  if (typeof value === "number") {
    return { processed: Math.max(0, value), skipped: 0, failed: 0 };
  }
  if (value && typeof value === "object") {
    const row = value as JobCounters & { applied?: boolean };
    return {
      processed:
        typeof row.processed === "number"
          ? Math.max(0, row.processed)
          : row.applied
            ? 1
            : 0,
      skipped:
        typeof row.skipped === "number" ? Math.max(0, row.skipped) : 0,
      failed: typeof row.failed === "number" ? Math.max(0, row.failed) : 0,
    };
  }
  return { processed: 0, skipped: 0, failed: 0 };
}

/** Worker scheduled job 用の境界。例外を隔離し、1 job 1行の安全な集計ログを出す。 */
export async function runJob(
  worker: string,
  job: string,
  task: () => Promise<unknown>,
): Promise<JobRunResult> {
  const startedMs = Date.now();
  const runId = crypto.randomUUID();
  const startedAt = new Date(startedMs).toISOString();
  try {
    const counters = toCounters(await task());
    const result = counters.processed === 0 && counters.failed === 0 ? "skipped" : "ok";
    logWorkerJob({
      worker,
      job,
      run_id: runId,
      started_at: startedAt,
      ...counters,
      duration_ms: Date.now() - startedMs,
      result,
    });
    return { succeeded: true, ...counters };
  } catch (error) {
    const counters = { processed: 0, skipped: 0, failed: 1 };
    logWorkerJob({
      worker,
      job,
      run_id: runId,
      started_at: startedAt,
      ...counters,
      duration_ms: Date.now() - startedMs,
      result: "failed",
      error: safeErrorSummary(error),
    });
    return { succeeded: false, ...counters };
  }
}
