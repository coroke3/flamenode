type FollowUpEnv = { DB: D1Database };

const USERS_INDEX_FOLLOW_UP_TARGETS = [
  { targetType: "top", targetId: "global" },
  { targetType: "recommend", targetId: "global" },
] as const;

const FOLLOW_UP_REASON = "users_index_follow_up";

/** users_index 成功後に top/recommend を冪等 enqueue。挿入・更新があれば true。 */
export async function enqueueTopRecommendAfterUsersIndex(
  env: FollowUpEnv,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  let changed = false;
  for (const target of USERS_INDEX_FOLLOW_UP_TARGETS) {
    const bumped = await env.DB.prepare(
      `UPDATE static_rebuild_queue
       SET reason = ?, updated_at = MAX(updated_at + 1, ?)
       WHERE target_type = ? AND target_id = ?
         AND status IN ('pending', 'processing')`,
    )
      .bind(FOLLOW_UP_REASON, now, target.targetType, target.targetId)
      .run();
    if ((bumped.meta?.changes ?? 0) > 0) {
      changed = true;
      continue;
    }
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO static_rebuild_queue (
         id, target_type, target_id, reason, priority, status,
         attempt_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'normal', 'pending', 0, ?, ?)`,
    )
      .bind(
        `srb:${target.targetType}:${crypto.randomUUID()}`,
        target.targetType,
        target.targetId,
        FOLLOW_UP_REASON,
        now,
        now,
      )
      .run();
    if ((inserted.meta?.changes ?? 0) > 0) changed = true;
  }
  return changed;
}
