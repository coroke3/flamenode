import { rebuildTarget } from "./rebuild";
import {
  queueLimitForMode,
  queueModeWhereClause,
  resolveQueueOperationMode,
  shouldReconcileStaleQueue,
  shouldSkipQueueTarget,
  type OperationMode,
} from "./queuePolicy";

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
}

const DEPRECATED_TARGET_TYPES = new Set([
  "groups_index",
  "event_groups_index",
  "event_group",
]);

type QueueRow = {
  id: string;
  target_type: string;
  target_id: string;
  priority: string;
  attempt_count: number;
};

export async function getOperationMode(env: Env): Promise<OperationMode> {
  const row = (await env.DB.prepare(
    `SELECT operation_mode FROM system_settings WHERE id = 'default' LIMIT 1`,
  ).first()) as {
    operation_mode?: string;
  } | null;
  return resolveQueueOperationMode(row);
}

export async function processStaticRebuildQueue(env: Env): Promise<{
  processed: number;
  failed: number;
}> {
  const mode = await getOperationMode(env);
  if (mode === "maintenance") {
    return { processed: 0, failed: 0 };
  }

  const now = Math.floor(Date.now() / 1000);
  const limit = queueLimitForMode(mode);

  let sql = `
    SELECT id, target_type, target_id, priority, attempt_count
    FROM static_rebuild_queue
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
  `;
  sql += queueModeWhereClause(mode);
  sql += `
    ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      created_at ASC
    LIMIT ?
  `;

  const result = await env.DB.prepare(sql).bind(now, limit).all();
  const rows = (result.results ?? []) as QueueRow[];

  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    const marked = await markProcessing(env, row.id, now);
    if (!marked) continue;

    try {
      if (DEPRECATED_TARGET_TYPES.has(row.target_type)) {
        await markDone(env, row.id, now);
        processed++;
        continue;
      }
      if (
        shouldSkipQueueTarget(mode, row)
      ) {
        await markDone(env, row.id, now);
        processed++;
        continue;
      }
      await rebuildTarget(env, row.target_type, row.target_id);
      await markDone(env, row.id, now);
      processed++;
    } catch (error) {
      failed++;
      await markRetryOrFailed(env, row, error, now);
    }
  }

  if (shouldReconcileStaleQueue(mode)) {
    await reconcileStaleQueue(env, now);
  }

  return { processed, failed };
}

async function markProcessing(
  env: Env,
  id: string,
  now: number,
): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE static_rebuild_queue
     SET status = 'processing', processing_started_at = ?, updated_at = ?
     WHERE id = ? AND status = 'pending'`,
  )
    .bind(now, now, id)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

async function markDone(env: Env, id: string, now: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE static_rebuild_queue
     SET status = 'done', processed_at = ?, updated_at = ?, error = NULL
     WHERE id = ?`,
  )
    .bind(now, now, id)
    .run();
}

async function markRetryOrFailed(
  env: Env,
  row: QueueRow,
  error: unknown,
  now: number,
): Promise<void> {
  const attempt = Number(row.attempt_count ?? 0) + 1;
  const message = error instanceof Error ? error.message : String(error);
  if (attempt >= 4) {
    await env.DB.prepare(
      `UPDATE static_rebuild_queue
       SET status = 'failed', attempt_count = ?, error = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(attempt, message.slice(0, 500), now, row.id)
      .run();
    return;
  }
  const delay = attempt === 1 ? 60 : attempt === 2 ? 300 : 900;
  await env.DB.prepare(
    `UPDATE static_rebuild_queue
     SET status = 'pending', attempt_count = ?, error = ?, next_retry_at = ?,
         processing_started_at = NULL, updated_at = ?
     WHERE id = ?`,
  )
    .bind(attempt, message.slice(0, 500), now + delay, now, row.id)
    .run();
}

/** 失敗・長時間 pending の取り残し確認（全件再生成はしない） */
async function reconcileStaleQueue(env: Env, now: number): Promise<void> {
  const dayAgo = now - 86400;
  await env.DB.prepare(
    `UPDATE static_rebuild_queue
     SET priority = 'normal', updated_at = ?
     WHERE status = 'failed' AND updated_at < ? AND attempt_count < 4`,
  )
    .bind(now, dayAgo)
    .run();
}
