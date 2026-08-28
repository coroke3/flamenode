import "server-only";
import type { DB } from "@/lib/db/client";
import { buildStaticRebuildQueueBatch, enqueueStaticRebuildMany, type StaticRebuildQueueBatch } from "./enqueue";
import type { EnqueueStaticRebuildInput, StaticRebuildPriority } from "./types";
type HookBase = {
  requestedByUserId?: string | null;
  priority?: StaticRebuildPriority;
  reason: string;
};

export const MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS = 8;

function uniqueEventIds(primary: string | null | undefined, ids: readonly string[]): string[] {
  const unique = new Set<string>();
  if (primary) unique.add(primary);
  for (const id of ids) unique.add(id);
  return [...unique];
}
/** list_recent / list_popular / search_index。top section・recommend_core・users_index は含めない。 */

function globalListTargets(
  reason: string,
  searchPriority?: StaticRebuildPriority,
): EnqueueStaticRebuildInput[] {
  return [
    { targetType: "list_recent", targetId: "global", reason },
    { targetType: "list_popular", targetId: "global", reason },
    {
      targetType: "search_index",
      targetId: "global",
      reason,
      ...(searchPriority ? { priority: searchPriority } : {}),
    },
  ];
}

function withMeta(
  items: EnqueueStaticRebuildInput[],
  opts: {
    requestedByUserId?: string | null;
    priority?: StaticRebuildPriority;
  },
): EnqueueStaticRebuildInput[] {
  const priority = opts.priority ?? "low";
  return items.map((item) => ({
    ...item,
    requestedByUserId: opts.requestedByUserId,
    priority: item.priority ?? priority,
  }));
}

function topRecommendedTarget(
  reason: string,
  priority?: StaticRebuildPriority,
): EnqueueStaticRebuildInput {
  return {
    targetType: "top_recommended",
    targetId: "global",
    reason,
    ...(priority ? { priority } : {}),
  };
}

function topLatestTarget(
  reason: string,
  priority?: StaticRebuildPriority,
): EnqueueStaticRebuildInput {
  return {
    targetType: "top_latest",
    targetId: "global",
    reason,
    ...(priority ? { priority } : {}),
  };
}

function topNostalgicTarget(
  reason: string,
  priority?: StaticRebuildPriority,
): EnqueueStaticRebuildInput {
  return {
    targetType: "top_nostalgic",
    targetId: "global",
    reason,
    ...(priority ? { priority } : {}),
  };
}

function topStatsTarget(
  reason: string,
  priority?: StaticRebuildPriority,
): EnqueueStaticRebuildInput {
  return {
    targetType: "top_stats",
    targetId: "global",
    reason,
    ...(priority ? { priority } : {}),
  };
}

function recommendCoreTarget(
  reason: string,
  priority?: StaticRebuildPriority,
): EnqueueStaticRebuildInput {
  return {
    targetType: "recommend_core",
    targetId: "global",
    reason,
    ...(priority ? { priority } : {}),
  };
}
/** score 再計算で top 注目棚と recommend_core を更新する。 */

export function topScoreRebuildTargets(
  reason: string,
  priority?: StaticRebuildPriority,
): EnqueueStaticRebuildInput[] {
  return [topRecommendedTarget(reason, priority), recommendCoreTarget(reason, priority)];
}
/** 公開状態変更で必要な top section と recommend_core を更新する。 */

export function topVideoVisibilityTargets(
  reason: string,
  priority?: StaticRebuildPriority,
): EnqueueStaticRebuildInput[] {
  return [
    topRecommendedTarget(reason, priority),
    topLatestTarget(reason, priority),
    topNostalgicTarget(reason, priority),
    topStatsTarget(reason, priority),
    recommendCoreTarget(reason, priority),
  ];
}
/** カード変更で list/search と top section rehydrate を更新する。 */

export function topVideoCardTargets(
  reason: string,
  priority?: StaticRebuildPriority,
): EnqueueStaticRebuildInput[] {
  return [
    topRecommendedTarget(reason, priority),
    topLatestTarget(reason, priority),
    topNostalgicTarget(reason, priority),
    recommendCoreTarget(reason, priority),
    ...globalListTargets(reason, priority),
  ];
}
/** イベント変更で hero 用 top section を更新する。 */

export function topEventChangeTargets(
  reason: string,
  priority: StaticRebuildPriority = "normal",
): EnqueueStaticRebuildInput[] {
  return [
    { targetType: "top_events", targetId: "global", reason, priority },
    topStatsTarget(reason, priority),
    topSlotStatsGlobalTarget(reason, priority),
  ];
}
/** お知らせ変更で top announcements section を更新する。 */

export function topAnnouncementTarget(
  reason: string,
  priority: StaticRebuildPriority = "normal",
): EnqueueStaticRebuildInput {
  return { targetType: "top_announcements", targetId: "global", reason, priority };
}
/** 公開カード変更時に list / search / top section / recommend_core へ波及するターゲット。 */

export function buildVideoCardChangeFanOutTargets(opts: {
  reason: string;
  requestedByUserId?: string | null;
  priority?: StaticRebuildPriority;
}): EnqueueStaticRebuildInput[] {
  return withMeta(topVideoCardTargets(opts.reason, opts.priority), opts);
}

function eventBaseTarget(
  eventId: string,
  reason: string,
  priority?: StaticRebuildPriority,
  requestedByUserId?: string | null,
): EnqueueStaticRebuildInput {
  return {
    targetType: "event_base",
    targetId: eventId,
    reason,
    ...(priority ? { priority } : {}),
    ...(requestedByUserId !== undefined ? { requestedByUserId } : {}),
  };
}

function eventSlotsTarget(
  eventId: string,
  reason: string,
  priority?: StaticRebuildPriority,
  requestedByUserId?: string | null,
): EnqueueStaticRebuildInput {
  return {
    targetType: "event_slots",
    targetId: eventId,
    reason,
    ...(priority ? { priority } : {}),
    ...(requestedByUserId !== undefined ? { requestedByUserId } : {}),
  };
}

function eventReleaseTarget(
  eventId: string,
  reason: string,
  priority?: StaticRebuildPriority,
  requestedByUserId?: string | null,
): EnqueueStaticRebuildInput {
  return {
    targetType: "event_release",
    targetId: eventId,
    reason,
    ...(priority ? { priority } : {}),
    ...(requestedByUserId !== undefined ? { requestedByUserId } : {}),
  };
}

function usersIndexTarget(reason: string): EnqueueStaticRebuildInput {
  return { targetType: "users_index", targetId: "global", reason };
}

/**
 * 合作メンバーX ID候補インデックス（内部autocomplete用R2 artifact）。
 * targetIdは常にglobalで統一し、重複enqueueはqueueのdedupeに任せる。
 */
export function memberSuggestionsTarget(
  reason: string,
  priority: StaticRebuildPriority = "low",
): EnqueueStaticRebuildInput {
  return { targetType: "member_suggestions", targetId: "global", reason, priority };
}
/** 枠変更で top slot-stats artifact を更新する。 */

export function topSlotStatsGlobalTarget(
  reason: string,
  priority: StaticRebuildPriority = "normal",
): EnqueueStaticRebuildInput {
  return { targetType: "top_slot_stats", targetId: "global", reason, priority };
}
/** top composer を直接 enqueue する（通常は section producer の follow-up 経由）。 */

export function topGlobalTarget(
  reason: string,
  priority: StaticRebuildPriority = "normal",
): EnqueueStaticRebuildInput {
  return { targetType: "top", targetId: "global", reason, priority };
}

export async function enqueueAfterVideoCreate(
  db: DB,
  opts: {
    videoId: string;
    creatorXUserId: string | null;
    primaryEventId: string | null;
    eventIds: string[];
    requestedByUserId?: string | null;
  },
): Promise<void> {
  const items: EnqueueStaticRebuildInput[] = [
    {
      targetType: "video",
      targetId: opts.videoId,
      reason: "video_create",
      priority: "high",
      requestedByUserId: opts.requestedByUserId,
    },
    {
      targetType: "random_video_pool",
      targetId: "global",
      reason: "video_create",
      priority: "low",
      requestedByUserId: opts.requestedByUserId,
    },
    ...globalListTargets("video_create"),
  ];
  items.push(...topVideoVisibilityTargets("video_create"));
  if (opts.creatorXUserId) {
    items.push(
      { targetType: "user", targetId: opts.creatorXUserId, reason: "video_create" },
      usersIndexTarget("video_create"),
    );
  }
  // 作品作成はクリエイター/メンバーのoccurrence・lastSeenを変える。
  items.push(memberSuggestionsTarget("video_create"));
  for (const eventId of uniqueEventIds(opts.primaryEventId, opts.eventIds)) {
    items.push(eventBaseTarget(eventId, "video_create", "high", opts.requestedByUserId));
    items.push(eventReleaseTarget(eventId, "video_create", "high", opts.requestedByUserId));
  }
  await enqueueStaticRebuildMany(db, items);
}

export async function enqueueAfterVideoUpdate(
  db: DB,
  opts: {
    videoId: string;
    creatorXUserId: string | null;
    primaryEventId: string | null;
    eventIds: string[];
    visibilityChanged: boolean;
    identityChanged: boolean;
    eventMembershipChanged: boolean;
    randomPoolCardChanged?: boolean;
    requestedByUserId?: string | null;
  },
): Promise<void> {
  const items: EnqueueStaticRebuildInput[] = [
    {
      targetType: "video",
      targetId: opts.videoId,
      reason: "video_update",
      priority: "normal",
      requestedByUserId: opts.requestedByUserId,
    },
  ];
  if (opts.creatorXUserId && opts.identityChanged) {
    items.push(
      {
        targetType: "user",
        targetId: opts.creatorXUserId,
        reason: "video_identity_update",
      },
      usersIndexTarget("video_identity_update"),
      {
        targetType: "search_index",
        targetId: "global",
        reason: "video_identity_update",
        priority: "low",
      },
    );
    // クリエイター表示名・X IDの変更はmember suggestionsのname/occurrenceに響く。
    items.push(memberSuggestionsTarget("video_identity_update"));
  }
  const listAffecting =
    opts.visibilityChanged || opts.eventMembershipChanged || opts.identityChanged;
  const cardChanged =
    opts.randomPoolCardChanged ?? listAffecting;
  if (opts.visibilityChanged) {
    items.push({
      targetType: "youtube_related_blocklist",
      targetId: "global",
      reason: "video_visibility_changed",
      priority: "normal",
      requestedByUserId: opts.requestedByUserId,
    });
  }
  if (cardChanged) {
    items.push({
      targetType: "random_video_pool",
      targetId: "global",
      reason: "video_card_update",
      priority: "low",
      requestedByUserId: opts.requestedByUserId,
    });
    items.push(
      ...buildVideoCardChangeFanOutTargets({
        reason: "video_card_update",
        requestedByUserId: opts.requestedByUserId,
        priority: "low",
      }),
    );
  }
  if (opts.eventMembershipChanged || opts.visibilityChanged) {
    for (const eventId of uniqueEventIds(opts.primaryEventId, opts.eventIds)) {
      items.push(eventBaseTarget(eventId, "video_update"));
      items.push(eventReleaseTarget(eventId, "video_update", undefined, opts.requestedByUserId));
    }
  }
  await enqueueStaticRebuildMany(db, items);
}

export async function enqueueAfterXUserPublicUpdate(
  db: DB,
  opts: {
    xUserId: string;
    reason: string;
    requestedByUserId?: string | null;
  },
): Promise<void> {
  await enqueueStaticRebuildMany(db, [
    {
      targetType: "user",
      targetId: opts.xUserId,
      reason: opts.reason,
      requestedByUserId: opts.requestedByUserId,
    },
    usersIndexTarget(opts.reason),
    memberSuggestionsTarget(opts.reason),
  ]);
}

/**
 * Xプロフィール/アイコンのD1更新と同じmutateWithAudit batchへ含める
 * 静的投影キューを構築する。呼び出し側は statements/expectedChanges を
 * 本体mutationへ追加し、staticRebuildWakeSourceも渡すこと。
 */
export function buildAfterXUserPublicUpdateQueueBatch(
  db: DB,
  opts: {
    xUserId: string;
    reason: string;
    requestedByUserId?: string | null;
  },
): Promise<StaticRebuildQueueBatch> {
  return buildStaticRebuildQueueBatch(db, [
    {
      targetType: "user",
      targetId: opts.xUserId,
      reason: opts.reason,
      requestedByUserId: opts.requestedByUserId,
    },
    {
      targetType: "users_index",
      targetId: "global",
      reason: opts.reason,
      requestedByUserId: opts.requestedByUserId,
    },
    memberSuggestionsTarget(opts.reason),
  ]);
}

export function buildAfterVideoStatusChangeQueueBatch(
  db: DB,
  opts: {
    videoId: string;
    eventIds: string[];
    creatorXUserId?: string | null;
    primaryEventId?: string | null;
    requestedByUserId?: string | null;
  },
): Promise<StaticRebuildQueueBatch> {
  const eventIds = uniqueEventIds(opts.primaryEventId, opts.eventIds).filter(Boolean);
  if (eventIds.length > MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS) {
    throw new Error("video_status_rebuild_event_limit_exceeded");
  }
  const items: EnqueueStaticRebuildInput[] = [
    {
      targetType: "video",
      targetId: opts.videoId,
      reason: "video_visibility_update",
      priority: "high",
      requestedByUserId: opts.requestedByUserId,
    },
    {
      targetType: "youtube_related_blocklist",
      targetId: "global",
      reason: "video_visibility_changed",
      priority: "normal",
      requestedByUserId: opts.requestedByUserId,
    },
    {
      targetType: "random_video_pool",
      targetId: "global",
      reason: "video_visibility_changed",
      priority: "normal",
      requestedByUserId: opts.requestedByUserId,
    },
    ...globalListTargets("video_update", "low"),
  ];
  if (opts.creatorXUserId) {
    items.push(
      {
        targetType: "user",
        targetId: opts.creatorXUserId,
        reason: "video_update",
      },
      usersIndexTarget("video_update"),
    );
  }
  items.push(...withMeta(topVideoVisibilityTargets("video_update", "low"), {
    requestedByUserId: opts.requestedByUserId,
    priority: "low",
  }));
  for (const eventId of eventIds) {
    items.push(eventBaseTarget(eventId, "video_update", undefined, opts.requestedByUserId));
    items.push(eventReleaseTarget(eventId, "video_update", undefined, opts.requestedByUserId));
  }
  return buildStaticRebuildQueueBatch(db, items);
}

export function buildEventGroupChangeQueueBatch(
  db: DB,
  opts: Pick<HookBase, "reason" | "requestedByUserId">,
): Promise<StaticRebuildQueueBatch> {
  return buildStaticRebuildQueueBatch(db, [
    {
      targetType: "events_index",
      targetId: "global",
      reason: opts.reason,
      priority: "low",
      requestedByUserId: opts.requestedByUserId,
    },
  ]);
}

export function buildSlotChangeQueueBatch(
  db: DB,
  opts: {
    eventId: string;
    reason: string;
    requestedByUserId: string;
  },
): Promise<StaticRebuildQueueBatch> {
  return buildStaticRebuildQueueBatch(db, [
    eventSlotsTarget(opts.eventId, opts.reason, "high", opts.requestedByUserId),
    eventReleaseTarget(opts.eventId, opts.reason, "high", opts.requestedByUserId),
    topSlotStatsGlobalTarget(opts.reason, "normal"),
  ]);
}

export function buildEventChangeQueueBatch(
  db: DB,
  opts: {
    eventId: string;
    reason: string;
    requestedByUserId?: string | null;
    priority?: StaticRebuildPriority;
    /**
     * ID rename の旧IDだけは composed artifact も削除する必要がある。
     * 通常のイベント更新では composer が旧行を読むため有効にしない。
     */
    includeComposedCleanup?: boolean;
  },
): Promise<StaticRebuildQueueBatch> {
  const priority = opts.priority ?? "normal";
  const targets: EnqueueStaticRebuildInput[] = [
    eventBaseTarget(opts.eventId, opts.reason, priority, opts.requestedByUserId),
    eventSlotsTarget(opts.eventId, opts.reason, priority, opts.requestedByUserId),
    eventReleaseTarget(opts.eventId, opts.reason, priority, opts.requestedByUserId),
    // list/recent and list/popular embed the primary event title. Refresh
    // both projections whenever an event is hidden, renamed, or edited so a
    // stale public event label is not served until the normal TTL expires.
    {
      targetType: "list_recent",
      targetId: "global",
      reason: opts.reason,
      priority: "low",
      requestedByUserId: opts.requestedByUserId,
    },
    {
      targetType: "list_popular",
      targetId: "global",
      reason: opts.reason,
      priority: "low",
      requestedByUserId: opts.requestedByUserId,
    },
    {
      targetType: "events_index",
      targetId: "global",
      reason: opts.reason,
      priority: "low",
      requestedByUserId: opts.requestedByUserId,
    },
    {
      targetType: "search_index",
      targetId: "global",
      reason: opts.reason,
      priority: "low",
      requestedByUserId: opts.requestedByUserId,
    },
    ...topEventChangeTargets(opts.reason, priority).map((target) => ({
      ...target,
      requestedByUserId: opts.requestedByUserId,
    })),
  ];
  if (opts.includeComposedCleanup) {
    targets.unshift({
      targetType: "event",
      targetId: opts.eventId,
      reason: opts.reason,
      priority,
      requestedByUserId: opts.requestedByUserId,
    });
  }
  return buildStaticRebuildQueueBatch(db, targets);
}

export function buildAnnouncementChangeQueueBatch(
  db: DB,
  opts: Pick<HookBase, "reason" | "requestedByUserId" | "priority">,
): Promise<StaticRebuildQueueBatch> {
  return buildStaticRebuildQueueBatch(db, [
    topAnnouncementTarget(opts.reason, opts.priority ?? "normal"),
  ]);
}
