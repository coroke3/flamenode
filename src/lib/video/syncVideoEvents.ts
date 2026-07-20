import { and, eq, inArray, or } from "drizzle-orm";
import { events as eventsTable, videoEvents, videoYoutubeMetadata } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { getEditableEventIds } from "@/lib/auth/ownership";
import { computeVideoEventSyncTarget } from "@/lib/video/eventSync";
import type { VideoAtomicWritePlan } from "@/lib/video/atomicWritePlan";
import {
  compositeAuditTargetId,
  emptyVideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { MAX_ATOMIC_VIDEO_EVENTS } from "@/lib/video/atomicLimits";
export { MAX_ATOMIC_VIDEO_EVENTS } from "@/lib/video/atomicLimits";

/** 一般ユーザーが video_events を変更できるかの判定に使うイベント列。 */
export type VideoEventUserLinkPolicy =
  | "video_event_links"
  | "unslotted_posts";

function eventAllowColumn(policy: VideoEventUserLinkPolicy) {
  return policy === "unslotted_posts"
    ? eventsTable.allow_unslotted_posts
    : eventsTable.allow_user_video_event_links;
}

/** 新規作品 (video_events 未作成) の同期先イベント ID を事前計算する。 */
export async function resolveEventSyncTargetForNewVideo(
  db: DB,
  args: {
    requested: string[];
    alwaysInclude?: string[];
    user: { id: string; role?: string | null };
    linkPolicy?: VideoEventUserLinkPolicy;
  },
): Promise<string[]> {
  const requested = args.requested;
  const alwaysInclude = args.alwaysInclude ?? [];
  const user = args.user;
  const linkPolicy = args.linkPolicy ?? "video_event_links";
  const allowColumn = eventAllowColumn(linkPolicy);
  const universe = Array.from(new Set([...requested, ...alwaysInclude]));
  if (universe.length > MAX_ATOMIC_VIDEO_EVENTS) {
    throw new Error("video_event_atomic_limit_exceeded");
  }

  if (user.role === "admin") {
    return computeVideoEventSyncTarget({
      current: [],
      requested,
      alwaysInclude,
      isAdmin: true,
    });
  }

  const allowMap = new Map<string, number>();
  if (universe.length > 0) {
    const rows = await db
      .select({
        id: eventsTable.id,
        allow: allowColumn,
      })
      .from(eventsTable)
      .where(inArray(eventsTable.id, universe));
    for (const r of rows) allowMap.set(r.id, r.allow);
  }
  const editableEventIds = new Set(await getEditableEventIds(db, user.id, universe));
  const userCanModify = (id: string) =>
    allowMap.get(id) === 1 || editableEventIds.has(id);
  return computeVideoEventSyncTarget({
    current: [],
    requested,
    alwaysInclude,
    isAdmin: false,
    modifiableEventIds: universe.filter(userCanModify),
  });
}

export async function buildVideoDerivedRowsPlan(
  db: DB,
  args: {
    videoId: string;
    youtubeVideoId: string | null;
    now: number;
    actorUserId: string;
  },
): Promise<VideoAtomicWritePlan> {
  // YouTube IDの唯一の正本はvideos.youtube_video_id。metadataへは保存しない。
  void args.youtubeVideoId;
  const existing = (
    await db
      .select()
      .from(videoYoutubeMetadata)
      .where(eq(videoYoutubeMetadata.video_id, args.videoId))
      .limit(1)
  )[0];
  if (!existing) {
    const after: typeof videoYoutubeMetadata.$inferSelect = {
      video_id: args.videoId,
      youtube_privacy_status: null,
      youtube_availability_status: null,
      duration_seconds: null,
      view_count: 0,
      synced_at: null,
      sync_status: "pending",
      sync_error: null,
      updated_at: args.now,
    };
    return {
      statements: [db.insert(videoYoutubeMetadata).values(after)],
      expectedChanges: [1],
      audits: [{
        table_name: "video_youtube_metadata",
        target_id: args.videoId,
        operation: "CREATE",
        before: null,
        after: { ...after },
        actor_user_id: args.actorUserId,
        context: "video-save:youtube-metadata",
        retention_class: "normal",
        strict: true,
      }],
    };
  }
  const after: typeof videoYoutubeMetadata.$inferSelect = {
    ...existing,
    sync_status: "pending",
    updated_at: args.now,
  };
  return {
    statements: [db.update(videoYoutubeMetadata).set({
      sync_status: "pending",
      updated_at: args.now,
    }).where(and(
      eq(videoYoutubeMetadata.video_id, args.videoId),
      expectedRowCondition({ expectedCurrent: existing }),
    )!)],
    expectedChanges: [1],
    audits: [{
      table_name: "video_youtube_metadata",
      target_id: args.videoId,
      operation: "UPDATE",
      before: { ...existing },
      after: { ...after },
      actor_user_id: args.actorUserId,
      context: "video-save:youtube-metadata",
      retention_class: "normal",
      strict: true,
    }],
  };
}

export async function resolveVideoEventSyncTargetIds(
  db: DB,
  videoId: string,
  args: {
    requested: string[];
    alwaysInclude?: string[];
    user: { id: string; role?: string | null };
    linkPolicy?: VideoEventUserLinkPolicy;
  },
): Promise<string[]> {
  const requested = args.requested;
  const alwaysInclude = args.alwaysInclude ?? [];
  const user = args.user;
  const linkPolicy = args.linkPolicy ?? "video_event_links";
  const allowColumn = eventAllowColumn(linkPolicy);

  const current = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, videoId))
    .limit(MAX_ATOMIC_VIDEO_EVENTS + 1);
  if (current.length > MAX_ATOMIC_VIDEO_EVENTS) {
    throw new Error("video_event_existing_atomic_limit_exceeded");
  }
  const currentIds = current.map((r) => r.event_id);

  if (user.role === "admin") {
    return computeVideoEventSyncTarget({
      current: currentIds,
      requested,
      alwaysInclude,
      isAdmin: true,
    });
  }

  const universe = Array.from(
    new Set([...currentIds, ...requested, ...alwaysInclude]),
  );
  if (universe.length > MAX_ATOMIC_VIDEO_EVENTS) {
    throw new Error("video_event_atomic_limit_exceeded");
  }
  const allowMap = new Map<string, number>();
  if (universe.length > 0) {
    const rows = await db
      .select({
        id: eventsTable.id,
        allow: allowColumn,
      })
      .from(eventsTable)
      .where(inArray(eventsTable.id, universe));
    for (const r of rows) allowMap.set(r.id, r.allow);
  }
  const editableEventIds = new Set(await getEditableEventIds(db, user.id, universe));
  const userCanModify = (id: string) =>
    allowMap.get(id) === 1 || editableEventIds.has(id);
  return computeVideoEventSyncTarget({
    current: currentIds,
    requested,
    alwaysInclude,
    isAdmin: false,
    modifiableEventIds: universe.filter(userCanModify),
  });
}

/**
 * `video_events` を policy 適用 + differential 同期する。
 */
export async function buildSyncVideoEventsPlan(
  db: DB,
  videoId: string,
  args: {
    targetEventIds: string[];
    actorUserId: string;
  },
): Promise<VideoAtomicWritePlan> {
  const target = Array.from(new Set(args.targetEventIds.filter(Boolean)));
  if (target.length > MAX_ATOMIC_VIDEO_EVENTS) {
    throw new Error("video_event_atomic_limit_exceeded");
  }
  const current = await db
    .select()
    .from(videoEvents)
    .where(eq(videoEvents.video_id, videoId))
    .limit(MAX_ATOMIC_VIDEO_EVENTS + 1);
  if (current.length > MAX_ATOMIC_VIDEO_EVENTS) {
    throw new Error("video_event_existing_atomic_limit_exceeded");
  }
  const currentIds = current.map((r) => r.event_id);
  const currentSet = new Set(currentIds);
  const targetSet = new Set(target);
  const removed = current.filter((row) => !targetSet.has(row.event_id));
  const added: (typeof videoEvents.$inferSelect)[] = target
    .filter((eventId) => !currentSet.has(eventId))
    .map((eventId) => ({ video_id: videoId, event_id: eventId }));
  const plan = emptyVideoAtomicWritePlan();
  if (removed.length > 0) {
    plan.statements.push(db.delete(videoEvents).where(or(...removed.map((row) => and(
      eq(videoEvents.video_id, row.video_id),
      eq(videoEvents.event_id, row.event_id),
    )!))!));
    plan.expectedChanges.push(removed.length);
    plan.audits.push(...removed.map((row) => ({
      table_name: "video_events",
      target_id: compositeAuditTargetId(row.video_id, row.event_id),
      operation: "DELETE" as const,
      before: { ...row },
      after: null,
      actor_user_id: args.actorUserId,
      context: "video-save:events",
      retention_class: "normal" as const,
      strict: true,
    })));
  }
  if (added.length > 0) {
    plan.statements.push(db.insert(videoEvents).values(added));
    plan.expectedChanges.push(added.length);
    plan.audits.push(...added.map((row) => ({
      table_name: "video_events",
      target_id: compositeAuditTargetId(row.video_id, row.event_id),
      operation: "CREATE" as const,
      before: null,
      after: { ...row },
      actor_user_id: args.actorUserId,
      context: "video-save:events",
      retention_class: "normal" as const,
      strict: true,
    })));
  }
  return plan;
}
