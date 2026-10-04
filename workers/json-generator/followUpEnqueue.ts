import { enqueueStaticRebuildTargets } from "./staticRebuildEnqueue.ts";

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
  // top_slot_stats has no composer follow-up: the public top loader overlays
  // top/slot-stats.v1.json whenever it is newer than top.json, so recomposing
  // top.json on every slot change would only add R2 reads/PUT and queue rows.
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
  return (await enqueueStaticRebuildTargets(env, targets, reason, "high")) > 0;
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
