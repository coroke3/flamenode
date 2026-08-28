type FollowUpEnv = { DB: D1Database };
type ComposerFollowUpTarget = {
  targetType: string;
  targetId: string;
};
type ComposerFollowUpSpec = {
  targets: readonly ComposerFollowUpTarget[];
  reason: string;
};

const TOP_COMPOSER_TARGET = { targetType: "top", targetId: "global" } as const;

const COMPOSER_FOLLOW_UP_BY_PRODUCER: Readonly<
  Record<string, ComposerFollowUpSpec>
> = {
  users_index: {
    targets: [TOP_COMPOSER_TARGET, { targetType: "recommend", targetId: "global" }],
    reason: "users_index_follow_up",
  },
  recommend_core: {
    targets: [{ targetType: "recommend", targetId: "global" }],
    reason: "recommend_core_follow_up",
  },
  top_recommended: {
    targets: [TOP_COMPOSER_TARGET],
    reason: "top_recommended_follow_up",
  },
  top_latest: {
    targets: [TOP_COMPOSER_TARGET],
    reason: "top_latest_follow_up",
  },
  top_nostalgic: {
    targets: [TOP_COMPOSER_TARGET],
    reason: "top_nostalgic_follow_up",
  },
  top_events: {
    targets: [TOP_COMPOSER_TARGET],
    reason: "top_events_follow_up",
  },
  top_announcements: {
    targets: [TOP_COMPOSER_TARGET],
    reason: "top_announcements_follow_up",
  },
  top_stats: {
    targets: [TOP_COMPOSER_TARGET],
    reason: "top_stats_follow_up",
  },
  top_slot_stats: {
    targets: [TOP_COMPOSER_TARGET],
    reason: "top_slot_stats_follow_up",
  },
};

const PER_TARGET_COMPOSER_FOLLOW_UP_BY_PRODUCER: Readonly<
  Record<string, { composerTargetType: string; reason: string }>
> = {
  event_base: {
    composerTargetType: "event",
    reason: "event_base_follow_up",
  },
  event_slots: {
    composerTargetType: "event",
    reason: "event_slots_follow_up",
  },
};

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
       SET reason = ?,
           priority = CASE WHEN priority = 'high' OR ? = 'high' THEN 'high' ELSE priority END,
           updated_at = MAX(updated_at + 1, ?)
       WHERE target_type = ? AND target_id = ?
         AND status IN ('pending', 'processing')`,
    )
      .bind(reason, "high", now, target.targetType, target.targetId)
      .run();
    if ((bumped.meta?.changes ?? 0) > 0) {
      changed = true;
      continue;
    }
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO static_rebuild_queue (
         id, target_type, target_id, reason, priority, status,
         attempt_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'high', 'pending', 0, ?, ?)`,
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

/** per-event producer 成功後に event composer を冪等 enqueue。 */
export async function enqueuePerTargetComposerFollowUp(
  env: FollowUpEnv,
  producerTargetType: string,
  targetId: string,
): Promise<boolean> {
  const spec = PER_TARGET_COMPOSER_FOLLOW_UP_BY_PRODUCER[producerTargetType];
  if (!spec) return false;
  return enqueueComposerTargets(
    env,
    [{ targetType: spec.composerTargetType, targetId }],
    spec.reason,
  );
}
