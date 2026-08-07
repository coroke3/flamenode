type FollowUpEnv = { DB: D1Database };

type ComposerFollowUpTarget = {
  targetType: string;
  targetId: string;
};

type ComposerFollowUpSpec = {
  targets: readonly ComposerFollowUpTarget[];
  reason: string;
};

const COMPOSER_FOLLOW_UP_BY_PRODUCER: Readonly<
  Record<string, ComposerFollowUpSpec>
> = {
  users_index: {
    targets: [
      { targetType: "top", targetId: "global" },
      { targetType: "recommend", targetId: "global" },
    ],
    reason: "users_index_follow_up",
  },
  recommend_core: {
    targets: [{ targetType: "recommend", targetId: "global" }],
    reason: "recommend_core_follow_up",
  },
};

// Future producer→composer continuations (not wired yet):
// - top_recommended → top
// - event_base / event_slots → event
// - top_slot_stats → top

async function enqueueComposerTargets(
  env: FollowUpEnv,
  targets: readonly ComposerFollowUpTarget[],
  reason: string,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  let changed = false;
  for (const target of targets) {
    const bumped = await env.DB.prepare(
      `UPDATE static_rebuild_queue
       SET reason = ?, updated_at = MAX(updated_at + 1, ?)
       WHERE target_type = ? AND target_id = ?
         AND status IN ('pending', 'processing')`,
    )
      .bind(reason, now, target.targetType, target.targetId)
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
        reason,
        now,
        now,
      )
      .run();
    if ((inserted.meta?.changes ?? 0) > 0) changed = true;
  }
  return changed;
}

/** producer 成功後に composer target を冪等 enqueue。挿入・更新があれば true。 */
export async function enqueueComposerFollowUps(
  env: FollowUpEnv,
  producerTargetType: string,
): Promise<boolean> {
  const spec = COMPOSER_FOLLOW_UP_BY_PRODUCER[producerTargetType];
  if (!spec) return false;
  return enqueueComposerTargets(env, spec.targets, spec.reason);
}

/** @deprecated Use enqueueComposerFollowUps(env, "users_index") */
export async function enqueueTopRecommendAfterUsersIndex(
  env: FollowUpEnv,
): Promise<boolean> {
  return enqueueComposerFollowUps(env, "users_index");
}
