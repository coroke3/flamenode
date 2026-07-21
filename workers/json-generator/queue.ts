import { rebuildTarget } from "./rebuild.ts";
import {
  queueLimitForMode,
  queueModeWhereClause,
  resolveQueueOperationMode,
  shouldReconcileStaleQueue,
  shouldSkipQueueTarget,
  type OperationMode,
} from "./queuePolicy.ts";
import { nextAttemptNumber } from "../shared/queue.ts";
import { safeErrorSummary } from "../shared/safeLog.ts";

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
}

const STALE_QUEUE_RECONCILE_LIMIT = 20;
const PROCESSING_LEASE_SEC = 5 * 60;
const PROCESSING_CONCURRENCY = 2;
const MAX_ATTEMPTS = 4;

type QueueRow = {
  id: string;
  target_type: string;
  target_id: string;
  priority: string;
  attempt_count: number;
};

type QueueOutcome = "processed" | "failed" | "skipped";
type QueueMetrics = { d1_changes: number };
function recordD1Changes(metrics: QueueMetrics | undefined, result: { meta?: { changes?: number } }): void {
  if (metrics) metrics.d1_changes += result.meta?.changes ?? 0;
}

function throwIfAborted(signal: AbortSignal | undefined, fallback: string): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(signal.reason === undefined ? fallback : String(signal.reason));
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
): Promise<{
  processed: number;
  failed: number;
  skipped: number;
  external_api_calls: number;
  d1_changes: number;
  retry_count: number;
  quota_stopped: boolean;
}> {
  return processStaticRebuildQueueImpl(env, signal);
}

async function processStaticRebuildQueueImpl(
  env: Env,
  signal?: AbortSignal,
): Promise<{
  processed: number;
  failed: number;
  skipped: number;
  external_api_calls: number;
  d1_changes: number;
  retry_count: number;
  quota_stopped: boolean;
}> {
  throwIfAborted(signal, "static rebuild queue aborted");
  const mode = await getOperationMode(env);
  throwIfAborted(signal, "static rebuild queue aborted");
  if (mode === "maintenance") {
    return { processed: 0, failed: 0, skipped: 1, external_api_calls: 0, d1_changes: 0, retry_count: 0, quota_stopped: false };
  }

  const metrics: QueueMetrics = { d1_changes: 0 };

  const now = Math.floor(Date.now() / 1000);
  const limit = queueLimitForMode(mode);

  if (shouldReconcileStaleQueue(mode)) {
    await reconcileStaleQueue(env, now, signal, metrics);
  }
  throwIfAborted(signal, "static rebuild queue aborted");

  let query = `
    SELECT id, target_type, target_id, priority, attempt_count
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

  const result = await env.DB.prepare(query).bind(now, limit).all();
  throwIfAborted(signal, "static rebuild queue aborted");
  const rows = (result.results ?? []) as QueueRow[];
  const summary = { processed: 0, failed: 0, skipped: 0 };

  for (
    let offset = 0;
    offset < rows.length;
    offset += PROCESSING_CONCURRENCY
  ) {
    throwIfAborted(signal, "static rebuild queue aborted");
    const chunk = rows.slice(offset, offset + PROCESSING_CONCURRENCY);
    const outcomes = await Promise.all(
      chunk.map((row) => processQueueRow(env, mode, row, now, signal, metrics)),
    );
    for (const outcome of outcomes) summary[outcome] += 1;
  }

  return { ...summary, external_api_calls: 0, d1_changes: metrics.d1_changes, retry_count: 0, quota_stopped: false };
}

async function processQueueRow(
  env: Env,
  mode: OperationMode,
  row: QueueRow,
  now: number,
  signal?: AbortSignal,
  metrics?: QueueMetrics,
): Promise<QueueOutcome> {
  throwIfAborted(signal, "static rebuild queue aborted");
  const token = await markProcessing(env, row.id, now, metrics);
  if (!token) return "skipped";

  try {
    throwIfAborted(signal, "static rebuild queue aborted");
    if (shouldSkipQueueTarget(mode, row)) {
      throwIfAborted(signal, "static rebuild queue aborted");
      return (await markDone(env, row.id, token, now, metrics))
        ? "processed"
        : "skipped";
    }
    await rebuildTarget(env, row.target_type, row.target_id, signal);
    throwIfAborted(signal, "static rebuild queue aborted");
    return (await markDone(env, row.id, token, now, metrics))
      ? "processed"
      : "skipped";
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal, "static rebuild queue aborted");
    await markRetryOrFailed(env, row, token, error, now, metrics);
    return "failed";
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
export async function markDone(
  env: Env,
  id: string,
  token: string,
  now: number,
  metrics?: QueueMetrics,
): Promise<boolean> {
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
     WHERE id = ? AND status = 'processing' AND lease_token = ?`,
  )
    .bind(now, now, id, token)
    .run();
  recordD1Changes(metrics, result);
  if ((result.meta?.changes ?? 0) === 1) return true;

  await recoverLeaseInvalidatedProcessing(env, id, now, metrics);
  return false;
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
      STALE_QUEUE_RECONCILE_LIMIT,
    )
    .run();
  recordD1Changes(metrics, expiredResult);
  throwIfAborted(signal, "static rebuild queue aborted");
}
