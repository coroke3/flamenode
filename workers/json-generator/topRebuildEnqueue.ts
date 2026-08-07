type EnqueueEnv = { DB: D1Database };

export async function enqueueTopSectionRebuild(
  env: EnqueueEnv,
  targetType: string,
  reason: string,
  priority: "high" | "normal" | "low",
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();

  const now = Math.floor(Date.now() / 1000);
  const activeUpdate = env.DB.prepare(
    `UPDATE static_rebuild_queue
        SET reason = ?,
            priority = CASE
              WHEN priority = 'high' OR ? = 'high' THEN 'high'
              WHEN priority = 'normal' OR ? = 'normal' THEN 'normal'
              ELSE priority
            END,
            updated_at = MAX(updated_at + 1, ?)
      WHERE target_type = ?
        AND target_id = 'global'
        AND status IN ('pending', 'processing')`,
  ).bind(reason, priority, priority, now, targetType);

  const insert = env.DB.prepare(
    `INSERT OR IGNORE INTO static_rebuild_queue (
       id, target_type, target_id, reason, priority, status,
       attempt_count, created_at, updated_at
     ) VALUES (
       ?, ?, 'global', ?, ?, 'pending', 0, ?, ?
     )`,
  ).bind(`srb:${targetType}:${crypto.randomUUID()}`, targetType, reason, priority, now, now);

  const results = await env.DB.batch([activeUpdate, insert]);
  signal?.throwIfAborted();

  return results.reduce(
    (sum, result) => sum + Math.max(0, Number(result.meta?.changes ?? 0)),
    0,
  );
}

/** @deprecated Use enqueueTopSectionRebuild(env, "top", ...) */
export async function enqueueTopRebuild(
  env: EnqueueEnv,
  reason: string,
  priority: "high" | "normal" | "low",
  signal?: AbortSignal,
): Promise<number> {
  return enqueueTopSectionRebuild(env, "top", reason, priority, signal);
}
