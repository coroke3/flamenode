import "server-only";

import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, inArray } from "drizzle-orm";
import { notificationOutbox, users } from "@/lib/db/schema";
import { shouldEnqueueUserNotification } from "./context";
import { enqueueNotification } from "./enqueue";
import {
  buildVideoApprovedNotification,
  buildVideoVoidedNotification,
  buildVideoVisibilityChangedNotification,
} from "./templates/video";

type AnyDb = LibSQLDatabase<any>;

export const VIDEO_STATUS_NOTIFICATION_PREFETCH_QUERY_COUNT = 2;

export type VideoStatusNotificationBatch = {
  statements: BatchItem<"sqlite">[];
  expectedChanges: number[];
};

/** Action の本体 mutation と同じ D1 batch に含める outbox INSERT を構築する。 */
export async function buildVideoStatusChangeNotificationBatch(
  db: AnyDb,
  args: Parameters<typeof enqueueVideoStatusChangeNotification>[1],
): Promise<VideoStatusNotificationBatch> {
  const empty = { statements: [], expectedChanges: [] };
  if (!shouldEnqueueUserNotification()) return empty;
  if (!args.recipientUserId?.trim() || args.prevStatus === args.nextStatus) return empty;
  if (!args.forceNotify && (args.nextStatus === "pending" || args.nextStatus === "draft")) return empty;

  const recipient = (await db.select({ id: users.id, enabled: users.is_notification_enabled })
    .from(users).where(eq(users.id, args.recipientUserId.trim())).limit(1))[0];
  if (!recipient?.id || recipient.enabled === 0) return empty;

  let type: string;
  let payload: Record<string, unknown>;
  const base = { videoId: args.videoId, videoTitle: args.videoTitle, youtubeVideoId: args.youtubeVideoId, reason: args.reason ?? null };
  if (args.nextStatus === "public") {
    type = "video_approved";
    payload = buildVideoApprovedNotification({ ...base, eventId: args.eventId ?? null, noteStaticDelay: true });
  } else if (args.nextStatus === "voided") {
    type = "video_voided";
    payload = buildVideoVoidedNotification(base);
  } else if (["limited", "private", "archived"].includes(args.nextStatus)) {
    type = ({ limited: "video_limited", private: "video_private", archived: "video_archived" } as const)[args.nextStatus as "limited" | "private" | "archived"];
    payload = buildVideoVisibilityChangedNotification(base);
  } else if (args.forceNotify) {
    type = "video_status_changed";
    payload = buildVideoVisibilityChangedNotification(base);
  } else return empty;

  const dedupeKey = type === "video_approved" ? `video_approved:${args.videoId}` : `video_status_changed:${args.videoId}:${args.nextStatus}`;
  const active = await db.select({ id: notificationOutbox.id }).from(notificationOutbox)
    .where(and(eq(notificationOutbox.dedupe_key, dedupeKey), inArray(notificationOutbox.status, ["pending", "processing", "sent"])))
    .limit(1);
  if (active.length > 0 && !args.forceNotify) return empty;

  const row = {
    id: crypto.randomUUID(), recipient_user_id: recipient.id, type,
    payload_json: JSON.stringify(payload), status: "pending" as const, attempt_count: 0,
    processing_started_at: null, next_attempt_at: null, last_error: null,
    event_id: args.eventId ?? null, dedupe_key: dedupeKey,
    created_at: Math.floor(Date.now() / 1000),
  };
  return { statements: [db.insert(notificationOutbox).values(row)], expectedChanges: [1] };
}

/**
 * 作品の公開状態変更時に投稿者へ通知を enqueue する。
 * admin / manage の setVideoStatus から共通利用（文面・dedupe を一元化）。
 */
export async function enqueueVideoStatusChangeNotification(
  db: AnyDb,
  args: {
    videoId: string;
    videoTitle: string;
    youtubeVideoId?: string | null;
    prevStatus: string;
    nextStatus: string;
    reason?: string | null;
    recipientUserId: string | null | undefined;
    eventId?: string | null;
    forceNotify?: boolean;
  },
): Promise<void> {
  if (!shouldEnqueueUserNotification()) return;
  if (!args.recipientUserId?.trim()) return;
  if (args.prevStatus === args.nextStatus) return;

  const status = args.nextStatus;
  const forceNotify = args.forceNotify === true;
  if (!forceNotify && (status === "pending" || status === "draft")) return;

  const baseArgs = {
    videoId: args.videoId,
    videoTitle: args.videoTitle,
    youtubeVideoId: args.youtubeVideoId,
    reason: args.reason ?? null,
  };
  const eventId = args.eventId ?? null;

  if (status === "public") {
    await enqueueNotification(db, {
      recipientUserId: args.recipientUserId,
      type: "video_approved",
      dedupeKey: `video_approved:${args.videoId}`,
      payload: buildVideoApprovedNotification({
        ...baseArgs,
        eventId,
        noteStaticDelay: true,
      }),
      eventId,
    });
    return;
  }

  if (status === "voided") {
    await enqueueNotification(db, {
      recipientUserId: args.recipientUserId,
      type: "video_voided",
      dedupeKey: `video_status_changed:${args.videoId}:${status}`,
      payload: buildVideoVoidedNotification(baseArgs),
      eventId,
    });
    return;
  }

  if (
    status === "limited" ||
    status === "private" ||
    status === "archived"
  ) {
    const typeMap = {
      limited: "video_limited",
      private: "video_private",
      archived: "video_archived",
    } as const;
    await enqueueNotification(db, {
      recipientUserId: args.recipientUserId,
      type: typeMap[status],
      dedupeKey: `video_status_changed:${args.videoId}:${status}`,
      payload: buildVideoVisibilityChangedNotification(baseArgs),
      eventId,
    });
    return;
  }

  if (forceNotify) {
    await enqueueNotification(db, {
      recipientUserId: args.recipientUserId,
      type: "video_status_changed",
      dedupeKey: `video_status_changed:${args.videoId}:${status}`,
      payload: buildVideoVisibilityChangedNotification(baseArgs),
      eventId,
      force: true,
    });
  }
}
