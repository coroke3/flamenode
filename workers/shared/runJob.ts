import { logWorkerJob, normalizeQuotaStopReason, safeErrorSummary } from "./safeLog.ts";

export interface JobCounters {
  processed?: number;
  skipped?: number;
  failed?: number;
  external_api_calls?: number;
  d1_changes?: number;
  d1_statements?: number;
  d1_rows_read?: number;
  d1_rows_written?: number;
  retry_count?: number;
  quota_stopped?: boolean;
  quota_stop_reason?: string;
}

export interface JobRunResult {
  succeeded: boolean;
  processed: number;
  skipped: number;
  failed: number;
  external_api_calls?: number;
  d1_changes?: number;
  d1_statements?: number;
  d1_rows_read?: number;
  d1_rows_written?: number;
  retry_count?: number;
  quota_stopped?: boolean;
  quota_stop_reason?: string;
}

export interface RunJobOptions {
  /** true の場合、通常例外または failed>0 をログ後に上位へ伝播する。制御用cancelは常に伝播する。 */
  rethrow?: boolean;
  /** 40桁hexのコミット識別子（ログには小文字で出力） */
  commitSha?: string;
}

/**
 * Request-local identity shared by the worker log and the task callback.
 *
 * A task may ignore the argument (the pre-context callback shape remains
 * source-compatible), but jobs that persist history must use this runId
 * instead of creating a second UUID.
 */
export type JobRunContext = {
  runId: string;
  startedAtMs: number;
  startedAt: string;
};

class JobCountersError extends Error {
  readonly counters: NormalizedJobCounters;
  readonly logError = "job reported failed operations";

  constructor(message: string, counters: NormalizedJobCounters) {
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

export type NormalizedJobCounters = {
  processed: number;
  skipped: number;
  failed: number;
} & Omit<JobCounters, "processed" | "skipped" | "failed">;

function normalizeMetric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : undefined;
}

/** Workerが返す任意形状を、安全な集計値へ正規化する。 */
export function normalizeJobCounters(value: unknown): NormalizedJobCounters {
  const empty = { processed: 0, skipped: 0, failed: 0 } as ReturnType<typeof normalizeJobCounters>;
  if (typeof value === "number") {
    return { ...empty, processed: normalizeCounter(value) };
  }
  if (value && typeof value === "object") {
    const row = value as JobCounters & { applied?: boolean };
    const hasProcessed =
      typeof row.processed === "number" && Number.isFinite(row.processed);
    const result = {
      processed: hasProcessed
        ? normalizeCounter(row.processed)
        : row.applied
          ? 1
          : 0,
      skipped: normalizeCounter(row.skipped),
      failed: normalizeCounter(row.failed),
    };
    for (const key of [
      "external_api_calls",
      "d1_changes",
      "d1_statements",
      "d1_rows_read",
      "d1_rows_written",
      "retry_count",
    ] as const) {
      const metric = normalizeMetric((row as JobCounters)[key]);
      if (metric !== undefined) result[key] = metric;
    }
    if (typeof row.quota_stopped === "boolean") result.quota_stopped = row.quota_stopped;
    const reason = normalizeQuotaStopReason(row.quota_stop_reason);
    if (reason !== undefined) result.quota_stop_reason = reason;
    return result;
  }
  return empty;
}

/**
 * 例外で終了した処理が、失敗までに消費した外部 API・D1・再試行数を
 * `runJob` の構造化ログへ引き継ぐための安全なラッパー。
 */
export class JobFailureWithCounters extends Error {
  readonly counters: NormalizedJobCounters;
  readonly logError: string;
  readonly originalError: unknown;

  constructor(error: unknown, counters: JobCounters) {
    const summary = safeErrorSummary(error);
    super(summary);
    this.name = "JobFailureWithCounters";
    this.counters = normalizeJobCounters(counters);
    this.logError = summary;
    this.originalError = error;
  }
}

export function jobFailureWithCounters(
  error: unknown,
  counters: JobCounters,
): JobFailureWithCounters {
  return new JobFailureWithCounters(error, counters);
}

/**
 * `rethrow:false` は独立jobの通常障害を隔離するためのもの。Cron deadline / lease
 * loss / AbortError まで成功経路へ戻すと、中断後に別jobや外部APIを続行してしまう。
 */
export function isWorkerCancellation(error: unknown): boolean {
  let cause = error;
  while (cause instanceof JobFailureWithCounters) {
    cause = cause.originalError;
  }
  if (!(cause instanceof Error)) return false;
  if (cause.name === "AbortError") return true;
  return (
    cause.message.startsWith("cron wall-clock deadline exceeded:") ||
    cause.message.startsWith("cron task aborted:") ||
    cause.message.startsWith("cron lease lost")
  );
}

/** 複数の子ジョブ結果を同じ規則で合算する。 */
export function combineJobCounters(...values: unknown[]): NormalizedJobCounters {
  const total = {
    processed: 0,
    skipped: 0,
    failed: 0,
  };
  for (const value of values) {
    const counters = normalizeJobCounters(value);
    total.processed += counters.processed;
    total.skipped += counters.skipped;
    total.failed += counters.failed;
    for (const key of [
      "external_api_calls",
      "d1_changes",
      "d1_statements",
      "d1_rows_read",
      "d1_rows_written",
      "retry_count",
    ] as const) {
      if (typeof counters[key] === "number") total[key] = (total[key] ?? 0) + counters[key];
    }
    if (typeof counters.quota_stopped === "boolean") total.quota_stopped = (total.quota_stopped ?? false) || counters.quota_stopped;
    if (counters.quota_stop_reason !== undefined && total.quota_stop_reason === undefined) total.quota_stop_reason = counters.quota_stop_reason;
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
): NormalizedJobCounters {
  const counters = normalizeJobCounters(value);
  if (counters.failed > 0) {
    throw new JobCountersError(
      `${worker}/${job} reported ${counters.failed} failed operation(s)`,
      counters,
    );
  }
  return counters;
}

function failedCounters(): NormalizedJobCounters {
  return { processed: 0, skipped: 0, failed: 1 };
}

/** Worker scheduled job 用の境界。1 job 1行の安全な集計ログを出す。 */
export async function runJob(
  worker: string,
  job: string,
  task: (context: JobRunContext) => Promise<unknown>,
  options: RunJobOptions = {},
): Promise<JobRunResult> {
  const startedMs = Date.now();
  const runId = crypto.randomUUID();
  const startedAt = new Date(startedMs).toISOString();
  const commitSha = typeof options.commitSha === "string" && /^[0-9a-f]{40}$/i.test(options.commitSha)
    ? options.commitSha.toLowerCase()
    : undefined;

  const logMetrics = (value: NormalizedJobCounters) => ({
    external_api_calls: value.external_api_calls ?? 0,
    d1_changes: value.d1_changes ?? 0,
    d1_statements: value.d1_statements ?? 0,
    d1_rows_read: value.d1_rows_read ?? 0,
    d1_rows_written: value.d1_rows_written ?? 0,
    retry_count: value.retry_count ?? 0,
    quota_stopped: value.quota_stopped ?? false,
    ...(value.quota_stop_reason ? { quota_stop_reason: value.quota_stop_reason } : {}),
    ...(commitSha ? { commit_sha: commitSha } : {}),
  });

  let counters: NormalizedJobCounters;
  try {
    counters = normalizeJobCounters(
      await task({ runId, startedAtMs: startedMs, startedAt }),
    );
  } catch (error) {
    const measuredFailure =
      error instanceof JobCountersError || error instanceof JobFailureWithCounters;
    counters =
      measuredFailure ? error.counters : failedCounters();
    logWorkerJob({
      worker,
      job,
      run_id: runId,
      started_at: startedAt,
      ...counters,
      ...logMetrics(counters),
      duration_ms: Date.now() - startedMs,
      result: "failed",
      error:
        measuredFailure
          ? error.logError
          : safeErrorSummary(error),
    });
    if (options.rethrow || isWorkerCancellation(error)) throw error;
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
    ...logMetrics(counters),
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
