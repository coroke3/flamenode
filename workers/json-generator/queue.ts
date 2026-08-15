import { optimizedRebuildTarget } from "./optimizedRebuild.ts";
import {
  queueLimitForMode,
  queueModeWhereClause,
  resolveQueueOperationMode,
  shouldReconcileStaleQueue,
  shouldSkipQueueTarget,
  type OperationMode,
} from "./queuePolicy.ts";
import { nextAttemptNumber } from "../shared/queue.ts";
import { isD1BudgetExhausted, type D1Budget } from "../shared/d1Budget.ts";
import { safeErrorSummary } from "../shared/safeLog.ts";

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
  d1Budget?: D1Budget;
}

const STALE_QUEUE_RECONCILE_LIMIT = 20;
const PROCESSING_LEASE_SEC = 5 * 60;
/** global target は重いため常に1件ずつ。個別 target も MAX_QUEUE_ITEMS_PER_RUN=1 で直列。 */
const PROCESSING_CONCURRENCY = 1;
const MAX_ATTEMPTS = 4;
const MARK_DONE_RETRY_ATTEMPTS = 3;
const MARK_DONE_RETRY_DELAY_MS = 50;
/** R2 rebuild 成功後に done 更新だけ失敗した行。再生成せず lease 回復で done へ進める。 */
export const REBUILD_SUCCEEDED_AWAITING_DONE_MARK =
  "rebuild_succeeded_awaiting_done_mark";

type QueueRow = {
  id: string;
  target_type: string;
  target_id: string;
  priority: string;
  attempt_count: number;
  updated_at: number;
};

type QueueOutcome = "processed" | "failed" | "skipped";
type QueueMetrics = { d1_changes: number };
export type ProcessStaticRebuildQueueOptions = {
  /** Recovery Cron が同一 invocation の先頭で reconcile 済みなら重複実行を抑止する。 */
  staleQueueAlreadyReconciled?: boolean;
};
function recordD1Changes(metrics: QueueMetrics | undefined, result: { meta?: { changes?: number } }): void {
  if (metrics) metrics.d1_changes += result.meta?.changes ?? 0;
}

function isEnvD1BudgetExhausted(env: Env): boolean {
  return env.d1Budget ? isD1BudgetExhausted(env.d1Budget) : false;
}

function d1BudgetMetrics(env: Env): {
  d1_statements: number;
  d1_rows_read: number;
  d1_rows_written: number;
} {
  return {
    d1_statements: env.d1Budget?.statements ?? 0,
    d1_rows_read: env.d1Budget?.rowsRead ?? 0,
    d1_rows_written: env.d1Budget?.rowsWritten ?? 0,
  };
}

function throwIfAborted(signal: AbortSignal | undefined, fallback: string): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(signal.reason === undefined ? fallback : String(signal.reason));
}

async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal, "static rebuild queue aborted");
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function cleanup(): void {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    function onAbort(): void {
      cleanup();
      if (signal?.reason instanceof Error) reject(signal.reason);
      else reject(new Error(signal?.reason === undefined ? "static rebuild queue aborted" : String(signal.reason)));
    }
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  throwIfAborted(signal, "static rebuild queue aborted");
}

async function completeQueueRow(
  env: Env,
  row: QueueRow,
  token: string,
  now: number,
  signal: AbortSignal | undefined,
  metrics: QueueMetrics | undefined,
): Promise<{ outcome: QueueOutcome; followUpPending: boolean }> {
  const markResult = await markDoneWithRetries(env, row.id, token, now, metrics, signal);
  if (markResult === "done") {
    return { outcome: "processed", followUpPending: false };
  }
  if (markResult === "requeued") {
    return { outcome: "processed", followUpPending: true };
  }
  if (await markDoneOrSuppressRedelivery(env, row.id, token, now, metrics, signal)) {
    return { outcome: "processed", followUpPending: false };
  }
  return { outcome: "skipped", followUpPending: false };
}

export async function getOperationMode(env: Env): Promise<OperationMode> {
  const row = (await env.DB.prepare(
    `SELECT operation_mode FROM system_settings WHERE id = 'default' LIMIT 1`,
  ).first()) as {
    operation_mode?: string;
  } | null;
  return resolveQueueOperationMode(row);
}

export async function processStaticRebuildQueue(
  env: Env,
  signal?: AbortSignal,
  options: ProcessStaticRebuildQueueOptions = {},
): Promise<{
  processed: number;
  failed: number;
  skipped: number;
  external_api_calls: number;
  d1_changes: number;
  d1_statements: number;
  d1_rows_read: number;
  d1_rows_written: number;
  retry_count: number;
  quota_stopped: boolean;
  hasMore: boolean;
}> {
  return processStaticRebuildQueueImpl(env, signal, options);
}

async function processStaticRebuildQueueImpl(
  env: Env,
  signal?: AbortSignal,
  options: ProcessStaticRebuildQueueOptions = {},
): Promise<{
  processed: number;
  failed: number;
  skipped: number;
  external_api_calls: number;
  d1_changes: number;
  d1_statements: number;
  d1_rows_read: number;
  d1_rows_written: number;
  retry_count: number;
  quota_stopped: boolean;
  hasMore: boolean;
}> {
  throwIfAborted(signal, "static rebuild queue aborted");
  const mode = await getOperationMode(env);
  throwIfAborted(signal, "static rebuild queue aborted");
  if (mode === "maintenance") {
    return {
      processed: 0,
      failed: 0,
      skipped: 1,
      external_api_calls: 0,
      d1_changes: 0,
      ...d1BudgetMetrics(env),
      retry_count: 0,
      quota_stopped: false,
      hasMore: false,
    };
  }

  const metrics: QueueMetrics = { d1_changes: 0 };

  if (isEnvD1BudgetExhausted(env)) {
    return {
      processed: 0,
      failed: 0,
      skipped: 0,
      external_api_calls: 0,
      d1_changes: 0,
      ...d1BudgetMetrics(env),
      retry_count: 0,
      quota_stopped: false,
      hasMore: true,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const processLimit = queueLimitForMode(mode);
  const fetchLimit = processLimit + 1;

  if (
    shouldReconcileStaleQueue(mode) &&
    !options.staleQueueAlreadyReconciled &&
    !isEnvD1BudgetExhausted(env)
  ) {
    await reconcileStaleQueue(env, now, signal, metrics);
  }
  throwIfAborted(signal, "static rebuild queue aborted");

  let query = `
    SELECT id, target_type, target_id, priority, attempt_count, updated_at
    FROM static_rebuild_queue
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
  `;
  query += queueModeWhereClause(mode);
  query += `
    ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      created_at ASC
    LIMIT ?
  `;

  const result = await env.DB.prepare(query).bind(now, fetchLimit).all();
  throwIfAborted(signal, "static rebuild queue aborted");
  const fetchedRows = (result.results ?? []) as QueueRow[];
  const hasMore = fetchedRows.length > processLimit;
  const rows = fetchedRows.slice(0, processLimit);
  const summary = { processed: 0, failed: 0, skipped: 0 };
  let followUpPending = false;

  for (
    let offset = 0;
    offset < rows.length;
    offset += PROCESSING_CONCURRENCY
  ) {
    throwIfAborted(signal, "static rebuild queue aborted");
    if (isEnvD1BudgetExhausted(env)) {
      followUpPending = true;
      break;
    }
    const chunk = rows.slice(offset, offset + PROCESSING_CONCURRENCY);
    const outcomes = await Promise.all(
      chunk.map((row) => processQueueRow(env, mode, row, now, signal, metrics)),
    );
    for (const outcome of outcomes) {
      summary[outcome.outcome] += 1;
      if (outcome.followUpPending) followUpPending = true;
    }
  }

  return {
    ...summary,
    external_api_calls: 0,
    d1_changes: metrics.d1_changes,
    ...d1BudgetMetrics(env),
    retry_count: 0,
    quota_stopped: false,
    hasMore: hasMore || followUpPending || isEnvD1BudgetExhausted(env),
  };
}

async function processQueueRow(
  env: Env,
  mode: OperationMode,
  row: QueueRow,
  now: number,
  signal?: AbortSignal,
  metrics?: QueueMetrics,
): Promise<{ outcome: QueueOutcome; followUpPending: boolean }> {
  throwIfAborted(signal, "static rebuild queue aborted");
  const token = await markProcessing(env, row.id, now, metrics);
  if (!token) return { outcome: "skipped", followUpPending: false };

  try {
    throwIfAborted(signal, "static rebuild queue aborted");
    if (shouldSkipQueueTarget(mode, row)) {
      throwIfAborted(signal, "static rebuild queue aborted");
      const completion = await completeQueueRow(env, row, token, now, signal, metrics);
      return { outcome: completion.outcome, followUpPending: completion.followUpPending };
    }
    const rebuildResult = await optimizedRebuildTarget(
      env,
      row.target_type,
      row.target_id,
      Number(row.updated_at) || 0,
      signal,
      row.reason,
    );
    throwIfAborted(signal, "static rebuild queue aborted");
    const completion = await completeQueueRow(env, row, token, now, signal, metrics);
    return {
      outcome: completion.outcome,
      followUpPending: rebuildResult.followUpPending || completion.followUpPending,
    };
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal, "static rebuild queue aborted");
    await markRetryOrFailed(env, row, token, error, now, metrics);
    return { outcome: "failed", followUpPending: false };
  }
}

export async function markProcessing(
  env: Env,
  id: string,
  now: number,
  metrics?: QueueMetrics,
): Promise<string | null> {
  const token = crypto.randomUUID();
  const result = await env.DB.prepare(
    `UPDATE static_rebuild_queue
     SET status = 'processing', processing_started_at = ?,
         lease_token = ?, lease_expires_at = ?, updated_at = ?
     WHERE id = ? AND status = 'pending'`,
  )
    .bind(now, token, now + PROCESSING_LEASE_SEC, now, id)
    .run();
  recordD1Changes(metrics, result);
  return (result.meta?.changes ?? 0) === 1 ? token : null;
}

/**
 * processing 中に enqueue が入ると updated_at が processing_started_at より新しくなる。
 * その場合は完了行にせず、同じ行を pending へ戻して次の世代を再生成する。
 */
export type MarkDoneAttemptResult = "done" | "requeued" | null;

export async function markDone(
  env: Env,
  id: string,
  token: string,
  now: number,
  metrics?: QueueMetrics,
): Promise<boolean> {
  const completed = await markDoneAttempt(env, id, token, now, metrics);
  if (completed !== null) return true;
  await recoverLeaseInvalidatedProcessing(env, id, now, metrics);
  return false;
}

async function markDoneAttempt(
  env: Env,
  id: string,
  token: string,
  now: number,
  metrics?: QueueMetrics,
): Promise<MarkDoneAttemptResult> {
  const result = await env.DB.prepare(
    `UPDATE static_rebuild_queue
     SET status = CASE
           WHEN updated_at > COALESCE(processing_started_at, updated_at)
             THEN 'pending'
           ELSE 'done'
         END,
         processed_at = CASE
           WHEN updated_at > COALESCE(processing_started_at, updated_at)
             THEN NULL
           ELSE ?
         END,
         updated_at = CASE
           WHEN updated_at > COALESCE(processing_started_at, updated_at)
             THEN updated_at
           ELSE ?
         END,
         attempt_count = 0,
         error = NULL,
         processing_started_at = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         next_retry_at = NULL
     WHERE id = ? AND status = 'processing' AND lease_token = ?
     RETURNING status`,
  )
    .bind(now, now, id, token)
    .all<{ status: string }>();
  recordD1Changes(metrics, result);
  const row = result.results?.[0];
  if (!row) return null;
  return row.status === "pending" ? "requeued" : "done";
}

export async function markDoneWithRetries(
  env: Env,
  id: string,
  token: string,
  now: number,
  metrics?: QueueMetrics,
  signal?: AbortSignal,
): Promise<MarkDoneAttemptResult> {
  for (let attempt = 0; attempt < MARK_DONE_RETRY_ATTEMPTS; attempt += 1) {
    const result = await markDoneAttempt(env, id, token, now, metrics);
    if (result !== null) return result;
    if (attempt < MARK_DONE_RETRY_ATTEMPTS - 1) {
      await sleepMs(MARK_DONE_RETRY_DELAY_MS, signal);
    }
  }
  return null;
}

export async function markDoneOrSuppressRedelivery(
  env: Env,
  id: string,
  token: string,
  now: number,
  metrics?: QueueMetrics,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal, "static rebuild queue aborted");
  const result = await env.DB.prepare(
    `UPDATE static_rebuild_queue
     SET error = ?, lease_expires_at = ?, updated_at = ?
     WHERE id = ? AND status = 'processing' AND lease_token = ?`,
  )
    .bind(REBUILD_SUCCEEDED_AWAITING_DONE_MARK, now + PROCESSING_LEASE_SEC, now, id, token)
    .run();
  recordD1Changes(metrics, result);
  throwIfAborted(signal, "static rebuild queue aborted");
  return (result.meta?.changes ?? 0) === 1;
}

export async function markRetryOrFailed(
  env: Env,
  row: QueueRow,
  token: string,
  error: unknown,
  now: number,
  metrics?: QueueMetrics,
): Promise<void> {
  const attempt = nextAttemptNumber(row.attempt_count);
  const message = safeErrorSummary(error).slice(0, 500);
  if (attempt >= MAX_ATTEMPTS) {
    const result = await env.DB.prepare(
      `UPDATE static_rebuild_queue
       SET status = 'failed', attempt_count = ?, error = ?, updated_at = ?,
           processing_started_at = NULL, lease_token = NULL,
           lease_expires_at = NULL, next_retry_at = NULL
       WHERE id = ? AND status = 'processing' AND lease_token = ?`,
    )
      .bind(attempt, message, now, row.id, token)
      .run();
    recordD1Changes(metrics, result);
    if ((result.meta?.changes ?? 0) === 0) {
      await recoverLeaseInvalidatedProcessing(env, row.id, now, metrics);
    }
    return;
  }

  const delay = attempt === 1 ? 60 : attempt === 2 ? 300 : 900;
  const result = await env.DB.prepare(
    `UPDATE static_rebuild_queue
     SET status = 'pending', attempt_count = ?, error = ?, next_retry_at = ?,
         processing_started_at = NULL, lease_token = NULL,
         lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'processing' AND lease_token = ?`,
  )
    .bind(attempt, message, now + delay, now, row.id, token)
    .run();
  recordD1Changes(metrics, result);
  if ((result.meta?.changes ?? 0) === 0) {
    await recoverLeaseInvalidatedProcessing(env, row.id, now, metrics);
  }
}

async function recoverLeaseInvalidatedProcessing(
  env: Env,
  id: string,
  now: number,
  metrics?: QueueMetrics,
): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE static_rebuild_queue
     SET status = CASE
           WHEN COALESCE(attempt_count, 0) + 1 >= ? THEN 'failed'
           ELSE 'pending'
         END,
         attempt_count = MIN(COALESCE(attempt_count, 0) + 1, ?),
         error = 'processing lease invalidated',
         next_retry_at = CASE
           WHEN COALESCE(attempt_count, 0) + 1 >= ? THEN NULL
           ELSE ?
         END,
         processed_at = NULL,
         processing_started_at = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE id = ? AND status = 'processing' AND lease_token IS NULL`,
  )
    .bind(
      MAX_ATTEMPTS,
      MAX_ATTEMPTS,
      MAX_ATTEMPTS,
      now + 60,
      now,
      id,
    )
    .run();
  recordD1Changes(metrics, result);
}

/** 失敗・長時間 processing の取り残し確認（全件再生成はしない） */
export async function reconcileStaleQueue(
  env: Env,
  now: number,
  signal?: AbortSignal,
  metrics?: QueueMetrics,
): Promise<void> {
  throwIfAborted(signal, "static rebuild queue aborted");
  const missingResult = await env.DB.prepare(
    `UPDATE static_rebuild_queue
     SET status = CASE
           WHEN COALESCE(attempt_count, 0) + 1 >= ? THEN 'failed'
           ELSE 'pending'
         END,
         attempt_count = MIN(COALESCE(attempt_count, 0) + 1, ?),
         processed_at = NULL,
         error = 'processing lease missing',
         next_retry_at = CASE
           WHEN COALESCE(attempt_count, 0) + 1 >= ? THEN NULL
           ELSE ?
         END,
         processing_started_at = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE status = 'processing' AND lease_token IS NULL
     LIMIT ?`,
  )
    .bind(
      MAX_ATTEMPTS,
      MAX_ATTEMPTS,
      MAX_ATTEMPTS,
      now + 60,
      now,
      STALE_QUEUE_RECONCILE_LIMIT,
    )
    .run();
  recordD1Changes(metrics, missingResult);

  throwIfAborted(signal, "static rebuild queue aborted");
  const rebuiltRecoveryResult = await env.DB.prepare(
    `UPDATE static_rebuild_queue
     SET status = 'done',
         processed_at = ?,
         attempt_count = 0,
         error = NULL,
         next_retry_at = NULL,
         processing_started_at = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE status = 'processing'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at <= ?
       AND error = ?
     LIMIT ?`,
  )
    .bind(now, now, now, REBUILD_SUCCEEDED_AWAITING_DONE_MARK, STALE_QUEUE_RECONCILE_LIMIT)
    .run();
  recordD1Changes(metrics, rebuiltRecoveryResult);

  throwIfAborted(signal, "static rebuild queue aborted");
  const expiredResult = await env.DB.prepare(
    `UPDATE static_rebuild_queue
     SET status = CASE
           WHEN COALESCE(attempt_count, 0) + 1 >= ? THEN 'failed'
           ELSE 'pending'
         END,
         attempt_count = MIN(COALESCE(attempt_count, 0) + 1, ?),
         error = CASE
           WHEN COALESCE(attempt_count, 0) + 1 >= ?
             THEN COALESCE(error, 'processing lease expired')
           ELSE COALESCE(error, 'processing lease expired; retry scheduled')
         END,
         next_retry_at = CASE
           WHEN COALESCE(attempt_count, 0) + 1 >= ? THEN NULL
           ELSE ?
         END,
         processing_started_at = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE status = 'processing'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at <= ?
       AND (error IS NULL OR error <> ?)
     LIMIT ?`,
  )
    .bind(
      MAX_ATTEMPTS,
      MAX_ATTEMPTS,
      MAX_ATTEMPTS,
      MAX_ATTEMPTS,
      now + 60,
      now,
      now,
      REBUILD_SUCCEEDED_AWAITING_DONE_MARK,
      STALE_QUEUE_RECONCILE_LIMIT,
    )
    .run();
  recordD1Changes(metrics, expiredResult);
  throwIfAborted(signal, "static rebuild queue aborted");
}
