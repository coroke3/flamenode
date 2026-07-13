import "server-only";

import type { BatchItem } from "drizzle-orm/batch";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { and, eq, inArray } from "drizzle-orm";
import { notificationOutbox, users } from "@/lib/db/schema";
import { shouldEnqueueUserNotification } from "./context";
import { enqueueNotification } from "./enqueue";
import {
  buildVideoApprovedNotification,
  buildVideoVisibilityChangedNotification,
} from "./templates/video";

type AnyDb = LibSQLDatabase<any>;
type VideoStatusNotificationArgs = {
  videoId: string;
  videoTitle: string;
  youtubeVideoId?: string | null;
  prevStatus: string;
  nextStatus: string;
  reason?: string | null;
  recipientUserId: string | null | undefined;
  eventId?: string | null;
  forceNotify?: boolean;
};
type NotificationSpec = {
  type: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
};

const VISIBILITY_NOTIFICATION_TYPES: Record<string, string> = {
  voided: "video_voided",
  limited: "video_limited",
  private: "video_private",
  archived: "video_archived",
};

export const VIDEO_STATUS_NOTIFICATION_PREFETCH_QUERY_COUNT = 2;
export type VideoStatusNotificationBatch = {
  statements: BatchItem<"sqlite">[];
  expectedChanges: number[];
};

function notificationSpec(args: VideoStatusNotificationArgs): NotificationSpec | null {
  const status = args.nextStatus;
  const force = args.forceNotify === true;
  if (args.prevStatus === status || (!force && (status === "pending" || status === "draft"))) {
    return null;
  }

  const base = {
    videoId: args.videoId,
    videoTitle: args.videoTitle,
    youtubeVideoId: args.youtubeVideoId,
    reason: args.reason ?? null,
  };
  if (status === "public") {
    return {
      type: "video_approved",
      dedupeKey: `video_approved:${args.videoId}`,
      payload: buildVideoApprovedNotification({
        ...base,
        eventId: args.eventId ?? null,
        noteStaticDelay: true,
      }),
    };
  }

  const type = VISIBILITY_NOTIFICATION_TYPES[status] ?? (force ? "video_status_changed" : null);
  return type
    ? {
        type,
        dedupeKey: `video_status_changed:${args.videoId}:${status}`,
        payload: buildVideoVisibilityChangedNotification(base),
      }
    : null;
}

/** Action の本体 mutation と同じ D1 batch に含める outbox INSERT を構築する。 */
export async function buildVideoStatusChangeNotificationBatch(
  db: AnyDb,
  args: VideoStatusNotificationArgs,
): Promise<VideoStatusNotificationBatch> {
  const empty = { statements: [], expectedChanges: [] };
  if (!shouldEnqueueUserNotification() || !args.recipientUserId?.trim()) return empty;
  const spec = notificationSpec(args);
  if (!spec) return empty;

  const recipient = (
    await db
      .select({ id: users.id, enabled: users.is_notification_enabled })
      .from(users)
      .where(eq(users.id, args.recipientUserId.trim()))
      .limit(1)
  )[0];
  if (!recipient?.id || recipient.enabled === 0) return empty;

  const active = await db
    .select({ id: notificationOutbox.id })
    .from(notificationOutbox)
    .where(
      and(
        eq(notificationOutbox.dedupe_key, spec.dedupeKey),
        inArray(notificationOutbox.status, ["pending", "processing", "sent"]),
      ),
    )
    .limit(1);
  if (active.length > 0 && !args.forceNotify) return empty;

  const row = {
    id: crypto.randomUUID(),
    recipient_user_id: recipient.id,
    type: spec.type,
    payload_json: JSON.stringify(spec.payload),
    status: "pending" as const,
    attempt_count: 0,
    processing_started_at: null,
    next_attempt_at: null,
    last_error: null,
    event_id: args.eventId ?? null,
    dedupe_key: spec.dedupeKey,
    created_at: Math.floor(Date.now() / 1000),
  };
  return { statements: [db.insert(notificationOutbox).values(row)], expectedChanges: [1] };
}

/** 作品の公開状態変更時に投稿者へ通知を enqueue する。 */
export async function enqueueVideoStatusChangeNotification(
  db: AnyDb,
  args: VideoStatusNotificationArgs,
): Promise<void> {
  if (!shouldEnqueueUserNotification() || !args.recipientUserId?.trim()) return;
  const spec = notificationSpec(args);
  if (!spec) return;

  await enqueueNotification(db, {
    recipientUserId: args.recipientUserId,
    type: spec.type,
    dedupeKey: spec.dedupeKey,
    payload: spec.payload,
    eventId: args.eventId ?? null,
    force: spec.type === "video_status_changed" ? true : undefined,
  });
}
