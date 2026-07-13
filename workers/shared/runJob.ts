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

class JobCountersError extends Error {
  readonly counters: Required<JobCounters>;
  readonly logError = "job reported failed operations";

  constructor(message: string, counters: Required<JobCounters>) {
    super(message);
    this.name = "JobCountersError";
    this.counters = counters;
  }
}

function normalizeCounter(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

/** Workerが返す任意形状を、安全な集計値へ正規化する。 */
export function normalizeJobCounters(value: unknown): Required<JobCounters> {
  if (typeof value === "number") {
    return { processed: normalizeCounter(value), skipped: 0, failed: 0 };
  }
  if (value && typeof value === "object") {
    const row = value as JobCounters & { applied?: boolean };
    const hasProcessed =
      typeof row.processed === "number" && Number.isFinite(row.processed);
    return {
      processed: hasProcessed
        ? normalizeCounter(row.processed)
        : row.applied
          ? 1
          : 0,
      skipped: normalizeCounter(row.skipped),
      failed: normalizeCounter(row.failed),
    };
  }
  return { processed: 0, skipped: 0, failed: 0 };
}

/** 複数の子ジョブ結果を同じ規則で合算する。 */
export function combineJobCounters(...values: unknown[]): Required<JobCounters> {
  const total: Required<JobCounters> = {
    processed: 0,
    skipped: 0,
    failed: 0,
  };
  for (const value of values) {
    const counters = normalizeJobCounters(value);
    total.processed += counters.processed;
    total.skipped += counters.skipped;
    total.failed += counters.failed;
  }
  return total;
}

/**
 * 子ジョブをすべて実行した後、failed件数だけを例外へ変換する。
 * `runJob` が件数を保持して再ログするため、外部の失敗挙動と集計値は変わらない。
 */
export function throwIfJobFailed(
  worker: string,
  job: string,
  value: unknown,
): Required<JobCounters> {
  const counters = normalizeJobCounters(value);
  if (counters.failed > 0) {
    throw new JobCountersError(
      `${worker}/${job} reported ${counters.failed} failed operation(s)`,
      counters,
    );
  }
  return counters;
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
    counters = normalizeJobCounters(await task());
  } catch (error) {
    counters =
      error instanceof JobCountersError ? error.counters : failedCounters();
    logWorkerJob({
      worker,
      job,
      run_id: runId,
      started_at: startedAt,
      ...counters,
      duration_ms: Date.now() - startedMs,
      result: "failed",
      error:
        error instanceof JobCountersError
          ? error.logError
          : safeErrorSummary(error),
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
    throw new JobCountersError(
      `${worker}/${job} reported ${counters.failed} failed operation(s)`,
      counters,
    );
  }
  return { succeeded, ...counters };
}
