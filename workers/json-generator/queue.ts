import { rebuildTarget } from "./rebuild.ts";
import {
  queueLimitForMode,
  queueModeWhereClause,
  resolveQueueOperationMode,
  shouldReconcileStaleQueue,
  shouldSkipQueueTarget,
  type OperationMode,
} from "./queuePolicy.ts";
import { safeErrorSummary } from "../shared/safeLog.ts";

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
}

export interface ProcessStaticQueueOptions {
  limit?: number;
  priorities?: readonly ("high" | "normal" | "low")[];
  targetTypes?: readonly string[];
  reconcile?: boolean;
}

const STALE_QUEUE_RECONCILE_LIMIT = 20;
const PROCESSING_LEASE_SEC = 5 * 60;
const MAX_ATTEMPTS = 4;

type QueueRow = {
  id: string;
  target_type: string;
  target_id: string;
  priority: string;
  attempt_count: number;
};

type QueueOutcome = "processed" | "failed" | "skipped";

export async function getOperationMode(env: Env): Promise<OperationMode> {
  const row = (await env.DB.prepare(
    `SELECT operation_mode FROM system_settings WHERE id = 'default' LIMIT 1`,
  ).first()) as {
    operation_mode?: string;
  } | null;
  return resolveQueueOperationMode(row);
}

function boundedLimit(mode: OperationMode, requested: number | undefined): number {
  const modeLimit = queueLimitForMode(mode);
  if (!Number.isFinite(requested)) return modeLimit;
  return Math.min(modeLimit, Math.max(1, Math.floor(requested ?? modeLimit)));
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(",");
}

export async function processStaticRebuildQueue(
  env: Env,
  options: ProcessStaticQueueOptions = {},
): Promise<{
  processed: number;
  failed: number;
  skipped: number;
}> {
  const mode = await getOperationMode(env);
  if (mode === "maintenance") {
    return { processed: 0, failed: 0, skipped: 1 };
  }

  const now = Math.floor(Date.now() / 1000);
  const limit = boundedLimit(mode, options.limit);

  if (
    options.reconcile !== false &&
    shouldReconcileStaleQueue(mode)
  ) {
    await reconcileStaleQueue(env, now);
  }

  const bindValues: unknown[] = [now];
  let query = `
    SELECT id, target_type, target_id, priority, attempt_count
    FROM static_rebuild_queue
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
  `;
  query += queueModeWhereClause(mode);

  const priorities = options.priorities?.filter(Boolean) ?? [];
  if (priorities.length > 0) {
    query += ` AND priority IN (${placeholders(priorities)})`;
    bindValues.push(...priorities);
  }

  const targetTypes = options.targetTypes?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (targetTypes.length > 0) {
    query += ` AND target_type IN (${placeholders(targetTypes)})`;
    bindValues.push(...targetTypes);
  }

  query += `
    ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      created_at ASC
    LIMIT ?
  `;
  bindValues.push(limit);

  const result = await env.DB.prepare(query).bind(...bindValues).all();
  const rows = (result.results ?? []) as QueueRow[];
  const outcomes: QueueOutcome[] = [];

  // D1/R2の同時接続数を増やさないため常に逐次処理する。
  for (const row of rows) {
    outcomes.push(await processQueueRow(env, mode, row, now));
  }

  return outcomes.reduce(
    (summary, outcome) => {
      summary[outcome] += 1;
      return summary;
    },
    { processed: 0, failed: 0, skipped: 0 },
  );
}

async function processQueueRow(
  env: Env,
  mode: OperationMode,
  row: QueueRow,
  now: number,
): Promise<QueueOutcome> {
  const token = await markProcessing(env, row.id, now);
  if (!token) return "skipped";

  try {
    if (shouldSkipQueueTarget(mode, row)) {
      return (await markDone(env, row.id, token, now))
        ? "processed"
        : "skipped";
    }
    await rebuildTarget(env, row.target_type, row.target_id);
    return (await markDone(env, row.id, token, now))
      ? "processed"
      : "skipped";
  } catch (error) {
    await markRetryOrFailed(env, row, token, error, now);
    return "failed";
  }
}

export async function markProcessing(
  env: Env,
  id: string,
  now: number,
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
  return (result.meta.changes ?? 0) === 1 ? token : null;
}

/**
 * processing中にenqueueが入るとupdated_atがprocessing_started_atより新しくなる。
 * その場合は完了行にせず、同じ行をpendingへ戻して次の世代を再生成する。
 */
export async function markDone(
  env: Env,
  id: string,
  token: string,
  now: number,
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
  if ((result.meta.changes ?? 0) === 1) return true;

  await recoverLeaseInvalidatedProcessing(env, id, now);
  return false;
}

export async function markRetryOrFailed(
  env: Env,
  row: QueueRow,
  token: string,
  error: unknown,
  now: number,
): Promise<void> {
  const attempt = Number(row.attempt_count ?? 0) + 1;
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
    if ((result.meta?.changes ?? 0) === 0) {
      await recoverLeaseInvalidatedProcessing(env, row.id, now);
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
  if ((result.meta?.changes ?? 0) === 0) {
    await recoverLeaseInvalidatedProcessing(env, row.id, now);
  }
}

async function recoverLeaseInvalidatedProcessing(
  env: Env,
  id: string,
  now: number,
): Promise<void> {
  await env.DB.prepare(
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
    .bind(MAX_ATTEMPTS, MAX_ATTEMPTS, MAX_ATTEMPTS, now + 60, now, id)
    .run();
}

/** 失敗・長時間processingの取り残し確認（全件再生成はしない）。 */
export async function reconcileStaleQueue(env: Env, now: number): Promise<void> {
  await env.DB.prepare(
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

  await env.DB.prepare(
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
}
