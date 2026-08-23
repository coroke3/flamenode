import { TOP_SLOT_STATS_OBJECT_KEY } from "../../src/lib/publicData/staticTopSlotStatsCore.ts";

type EnqueueEnv = { DB: D1Database; R2: R2Bucket };

export const TOP_SLOT_STATS_REPAIR_MAX_D1_STATEMENTS = 2;

export async function enqueueTopSlotStatsRebuild(
  env: EnqueueEnv,
  reason: string,
  priority: "high" | "low",
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();

  const now = Math.floor(Date.now() / 1000);
  const activeUpdate = env.DB.prepare(
    `UPDATE static_rebuild_queue
        SET reason = ?,
            priority = CASE
              WHEN priority = 'high' OR ? = 'high' THEN 'high'
              ELSE priority
            END,
            updated_at = MAX(updated_at + 1, ?)
      WHERE target_type = 'top_slot_stats'
        AND target_id = 'global'
        AND status IN ('pending', 'processing')`,
  ).bind(reason, priority, now);

  const insert = env.DB.prepare(
    `INSERT OR IGNORE INTO static_rebuild_queue (
       id, target_type, target_id, reason, priority, status,
       attempt_count, created_at, updated_at
     ) VALUES (
       ?, 'top_slot_stats', 'global', ?, ?, 'pending', 0, ?, ?
     )`,
  ).bind(`srb:top_slot_stats:${crypto.randomUUID()}`, reason, priority, now, now);

  const results = await env.DB.batch([activeUpdate, insert]);
  signal?.throwIfAborted();

  return results.reduce(
    (sum, result) => sum + Math.max(0, Number(result.meta?.changes ?? 0)),
    0,
  );
}

/** R2上の top slot-stats artifact が欠けていれば top_slot_stats:global を enqueue する。 */
export async function ensureTopSlotStatsOnR2(
  env: EnqueueEnv,
  options: {
    reason: string;
    priority: "high" | "low";
    signal?: AbortSignal;
  },
): Promise<number> {
  options.signal?.throwIfAborted();
  const head = await env.R2.head(TOP_SLOT_STATS_OBJECT_KEY);
  if (head) {
    return 0;
  }
  return enqueueTopSlotStatsRebuild(
    env,
    options.reason,
    options.priority,
    options.signal,
  );
}
