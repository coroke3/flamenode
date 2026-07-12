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
  db: DB;
  requestedByUserId?: string | null;
  priority?: StaticRebuildPriority;
  reason: string;
};

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
  const eventIdSet = new Set<string>();
  if (opts.primaryEventId) eventIdSet.add(opts.primaryEventId);
  for (const eid of opts.eventIds) eventIdSet.add(eid);

  const items: EnqueueStaticRebuildInput[] = [
    {
      targetType: "video",
      targetId: opts.videoId,
      reason: "video_create",
      priority: "high",
      requestedByUserId: opts.requestedByUserId,
    },
    { targetType: "top", targetId: "global", reason: "video_create" },
    { targetType: "list_recent", targetId: "global", reason: "video_create" },
    { targetType: "list_popular", targetId: "global", reason: "video_create" },
    { targetType: "search_index", targetId: "global", reason: "video_create" },
  ];

  if (opts.creatorXUserId) {
    items.push({
      targetType: "user",
      targetId: opts.creatorXUserId,
      reason: "video_create",
    });
  }

  for (const eventId of eventIdSet) {
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
    items.push({
      targetType: "user",
      targetId: opts.creatorXUserId,
      reason: "video_identity_update",
    });
    items.push({
      targetType: "search_index",
      targetId: "global",
      reason: "video_identity_update",
      priority: "low",
    });
  }

  const listAffecting =
    opts.visibilityChanged ||
    opts.eventMembershipChanged ||
    opts.identityChanged;

  if (listAffecting) {
    items.push(
      { targetType: "top", targetId: "global", reason: "video_update" },
      { targetType: "list_recent", targetId: "global", reason: "video_update" },
      { targetType: "list_popular", targetId: "global", reason: "video_update" },
      {
        targetType: "search_index",
        targetId: "global",
        reason: "video_update",
        priority: "low",
      },
    );
  }

  const eventIdSet = new Set<string>();
  if (opts.primaryEventId) eventIdSet.add(opts.primaryEventId);
  for (const eid of opts.eventIds) eventIdSet.add(eid);

  if (opts.eventMembershipChanged || opts.visibilityChanged) {
    for (const eventId of eventIdSet) {
      items.push({
        targetType: "event",
        targetId: eventId,
        reason: "video_update",
      });
    }
  }

  await enqueueStaticRebuildMany(db, items);
}

export async function enqueueAfterVideoStatusChange(
  db: DB,
  opts: {
    videoId: string;
    requestedByUserId?: string | null;
  },
): Promise<void> {
  const row = (
    await db
      .select({
        creator_x_user_id: videos.creator_x_user_id,
        primary_event_id: videos.primary_event_id,
      })
      .from(videos)
      .where(eq(videos.id, opts.videoId))
      .limit(1)
  )[0];

  const eventRows = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, opts.videoId));

  await enqueueAfterVideoUpdate(db, {
    videoId: opts.videoId,
    creatorXUserId: row?.creator_x_user_id ?? null,
    primaryEventId: row?.primary_event_id ?? null,
    eventIds: eventRows.map((r) => r.event_id),
    visibilityChanged: true,
    identityChanged: false,
    eventMembershipChanged: false,
    requestedByUserId: opts.requestedByUserId,
  });
}

export async function enqueueAfterEventSettingsChange(
  db: DB,
  opts: HookBase & { eventId: string },
): Promise<void> {
  const items: EnqueueStaticRebuildInput[] = [
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
  ];

  await enqueueStaticRebuildMany(db, items);
}

export async function buildEventGroupChangeQueueBatch(
  db: DB,
  opts: Pick<HookBase, "reason" | "requestedByUserId">,
): Promise<StaticRebuildQueueBatch> {
  return buildStaticRebuildQueueBatch(db, [{
    targetType: "events_index",
    targetId: "global",
    reason: opts.reason,
    priority: "low",
    requestedByUserId: opts.requestedByUserId,
  }]);
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
