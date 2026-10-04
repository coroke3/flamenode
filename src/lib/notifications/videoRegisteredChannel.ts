import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { resolveNotificationActor } from "./actor";
import type { NotificationOutboxStatement } from "./enqueue";
import { buildOpsChannelWebhookStatement } from "./opsWebhook";
import {
  buildChannelVideoRegisteredNotification,
  buildVideoRegisteredOpsThreadName,
} from "./templates/video";

type AnyDb = LibSQLDatabase<any>;

/**
 * 作品登録（枠投稿・自由投稿・未所属）を運営チャンネルへ知らせる outbox statement。
 * dedupe は作品単位なので、同じ作品の再投稿では二重に通知しない。
 */
export async function buildVideoRegisteredChannelStatement(
  db: AnyDb,
  input: {
    actorUserId: string;
    videoId: string;
    videoTitle: string;
    youtubeVideoId: string | null;
    registrationKind: "slot" | "free" | "unaffiliated";
    eventId: string | null;
    eventTitle: string | null;
    creatorDisplayName?: string | null;
  },
): Promise<NotificationOutboxStatement | null> {
  const actor = await resolveNotificationActor(db, input.actorUserId);
  return buildOpsChannelWebhookStatement(db, {
    target: "event",
    threadName: buildVideoRegisteredOpsThreadName(input.videoTitle, actor),
    actorUserId: input.actorUserId,
    payload: buildChannelVideoRegisteredNotification({
      videoId: input.videoId,
      videoTitle: input.videoTitle,
      youtubeVideoId: input.youtubeVideoId,
      registrationKind: input.registrationKind,
      eventId: input.eventId,
      eventTitle: input.eventTitle,
      actor,
      creatorDisplayName: input.creatorDisplayName,
    }),
    dedupeKey: `channel_video_registered:${input.videoId}`,
    eventId: input.eventId,
  });
}
