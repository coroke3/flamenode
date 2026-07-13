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

export interface RunJobOptions {
  /** true の場合、例外または failed>0 をログ後に上位へ伝播する。 */
  rethrow?: boolean;
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

function failedCounters(): Required<JobCounters> {
  return { processed: 0, skipped: 0, failed: 1 };
}

/** Worker scheduled job 用の境界。1 job 1行の安全な集計ログを出す。 */
export async function runJob(
  worker: string,
  job: string,
  task: () => Promise<unknown>,
  options: RunJobOptions = {},
): Promise<JobRunResult> {
  const startedMs = Date.now();
  const runId = crypto.randomUUID();
  const startedAt = new Date(startedMs).toISOString();

  let counters: Required<JobCounters>;
  try {
    counters = toCounters(await task());
  } catch (error) {
    counters = failedCounters();
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
    if (options.rethrow) throw error;
    return { succeeded: false, ...counters };
  }

  const succeeded = counters.failed === 0;
  const result = !succeeded
    ? "failed"
    : counters.processed === 0
      ? "skipped"
      : "ok";
  logWorkerJob({
    worker,
    job,
    run_id: runId,
    started_at: startedAt,
    ...counters,
    duration_ms: Date.now() - startedMs,
    result,
    ...(!succeeded ? { error: "job reported failed operations" } : {}),
  });

  if (!succeeded && options.rethrow) {
    throw new Error(`${worker}/${job} reported ${counters.failed} failed operation(s)`);
  }
  return { succeeded, ...counters };
}
