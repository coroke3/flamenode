import { and, eq, inArray } from "drizzle-orm";
import { events as eventsTable, videoEvents, videoYoutubeMetadata } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { getEditableEventIds } from "@/lib/auth/ownership";
import { computeVideoEventSyncTarget } from "@/lib/video/eventSync";

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

  if (user.role === "admin") {
    return computeVideoEventSyncTarget({
      current: [],
      requested,
      alwaysInclude,
      isAdmin: true,
    });
  }

  const universe = Array.from(new Set([...requested, ...alwaysInclude]));
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
  const editableEventIds = new Set(await getEditableEventIds(db, user.id));
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

export async function ensureVideoDerivedRows(
  db: DB,
  args: {
    videoId: string;
    youtubeVideoId: string | null;
    now: number;
  },
): Promise<void> {
  await db
    .insert(videoYoutubeMetadata)
    .values({
      video_id: args.videoId,
      youtube_video_id: args.youtubeVideoId,
      sync_status: "pending",
      view_count: 0,
      updated_at: args.now,
    })
    .onConflictDoNothing();

  await db
    .update(videoYoutubeMetadata)
    .set({
      youtube_video_id: args.youtubeVideoId,
      sync_status: "pending",
      updated_at: args.now,
    })
    .where(eq(videoYoutubeMetadata.video_id, args.videoId));
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
    .where(eq(videoEvents.video_id, videoId));
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
  const editableEventIds = new Set(await getEditableEventIds(db, user.id));
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
export async function syncVideoEvents(
  db: DB,
  videoId: string,
  args: {
    requested: string[];
    alwaysInclude?: string[];
    user: { id: string; role?: string | null };
    linkPolicy?: VideoEventUserLinkPolicy;
  },
): Promise<string[]> {
  const target = await resolveVideoEventSyncTargetIds(db, videoId, args);

  const current = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, videoId));
  const currentIds = current.map((r) => r.event_id);

  const currentSet = new Set(currentIds);
  const targetSet = new Set(target);
  for (const id of currentIds) {
    if (!targetSet.has(id)) {
      await db
        .delete(videoEvents)
        .where(
          and(
            eq(videoEvents.video_id, videoId),
            eq(videoEvents.event_id, id),
          )!,
        );
    }
  }
  for (const id of target) {
    if (!currentSet.has(id)) {
      await db
        .insert(videoEvents)
        .values({ video_id: videoId, event_id: id })
        .onConflictDoNothing();
    }
  }
  return target;
}
