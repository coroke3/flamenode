import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { videoEvents, videos } from "@/lib/db/schema";
import {
  buildStaticRebuildQueueBatch,
  enqueueStaticRebuild,
  enqueueStaticRebuildMany,
  type StaticRebuildQueueBatch,
} from "./enqueue";
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

function globalVideoTargets(
  reason: string,
  searchPriority?: StaticRebuildPriority,
): EnqueueStaticRebuildInput[] {
  return [
    { targetType: "top", targetId: "global", reason },
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
    ...globalVideoTargets("video_create"),
  ];
  if (opts.creatorXUserId) {
    items.push({ targetType: "user", targetId: opts.creatorXUserId, reason: "video_create" });
  }
  for (const eventId of uniqueEventIds(opts.primaryEventId, opts.eventIds)) {
    items.push({
      targetType: "event",
      targetId: eventId,
      reason: "video_create",
      priority: "high",
    });
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
      {
        targetType: "search_index",
        targetId: "global",
        reason: "video_identity_update",
        priority: "low",
      },
    );
  }

  const listAffecting =
    opts.visibilityChanged || opts.eventMembershipChanged || opts.identityChanged;
  if (listAffecting) items.push(...globalVideoTargets("video_update", "low"));

  if (opts.eventMembershipChanged || opts.visibilityChanged) {
    for (const eventId of uniqueEventIds(opts.primaryEventId, opts.eventIds)) {
      items.push({ targetType: "event", targetId: eventId, reason: "video_update" });
    }
  }
  await enqueueStaticRebuildMany(db, items);
}

export async function enqueueAfterVideoStatusChange(
  db: DB,
  opts: { videoId: string; requestedByUserId?: string | null },
): Promise<void> {
  const [rows, eventRows] = await Promise.all([
    db
      .select({
        creator_x_user_id: videos.creator_x_user_id,
        primary_event_id: videos.primary_event_id,
      })
      .from(videos)
      .where(eq(videos.id, opts.videoId))
      .limit(1),
    db
      .select({ event_id: videoEvents.event_id })
      .from(videoEvents)
      .where(eq(videoEvents.video_id, opts.videoId)),
  ]);
  const row = rows[0];
  await enqueueAfterVideoUpdate(db, {
    videoId: opts.videoId,
    creatorXUserId: row?.creator_x_user_id ?? null,
    primaryEventId: row?.primary_event_id ?? null,
    eventIds: eventRows.map(({ event_id }) => event_id),
    visibilityChanged: true,
    identityChanged: false,
    eventMembershipChanged: false,
    requestedByUserId: opts.requestedByUserId,
  });
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
      reason: "video_update",
      priority: "normal",
      requestedByUserId: opts.requestedByUserId,
    },
    ...globalVideoTargets("video_update", "low"),
  ];
  if (opts.creatorXUserId) {
    items.push({
      targetType: "user",
      targetId: opts.creatorXUserId,
      reason: "video_update",
    });
  }
  for (const eventId of eventIds) {
    items.push({
      targetType: "event",
      targetId: eventId,
      reason: "video_update",
      requestedByUserId: opts.requestedByUserId,
    });
  }
  return buildStaticRebuildQueueBatch(db, items);
}

export async function enqueueAfterEventSettingsChange(
  db: DB,
  opts: HookBase & { eventId: string },
): Promise<void> {
  await enqueueStaticRebuildMany(db, [
    {
      targetType: "event",
      targetId: opts.eventId,
      reason: opts.reason,
      priority: opts.priority ?? "normal",
      requestedByUserId: opts.requestedByUserId,
    },
    {
      targetType: "events_index",
      targetId: "global",
      reason: opts.reason,
      priority: "low",
    },
    {
      targetType: "search_index",
      targetId: "global",
      reason: opts.reason,
      priority: "low",
    },
  ]);
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

/** 手動再生成（管理画面） */
export async function enqueueManualStaticRebuild(
  db: DB,
  input: Omit<EnqueueStaticRebuildInput, "priority">,
): Promise<void> {
  await enqueueStaticRebuild(db, {
    ...input,
    priority: "high",
    reason: input.reason || "manual_rebuild",
  });
}
