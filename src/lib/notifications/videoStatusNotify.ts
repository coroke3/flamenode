import "server-only";

import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { shouldEnqueueUserNotification } from "./context";
import { enqueueNotification } from "./enqueue";
import {
  buildVideoApprovedNotification,
  buildVideoVoidedNotification,
  buildVideoVisibilityChangedNotification,
} from "./templates/video";

type AnyDb = LibSQLDatabase<any>;

/**
 * 作品の公開状態変更時に投稿者へ Discord 通知を enqueue する。
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
    discordUserId: string | null | undefined;
    eventId?: string | null;
    forceNotify?: boolean;
  },
): Promise<void> {
  if (!shouldEnqueueUserNotification()) return;
  if (!args.discordUserId?.trim()) return;
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
      discordUserId: args.discordUserId,
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
      discordUserId: args.discordUserId,
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
    status === "hidden" ||
    status === "archived"
  ) {
    const typeMap = {
      limited: "video_limited",
      private: "video_private",
      hidden: "video_hidden",
      archived: "video_archived",
    } as const;
    await enqueueNotification(db, {
      discordUserId: args.discordUserId,
      type: typeMap[status],
      dedupeKey: `video_status_changed:${args.videoId}:${status}`,
      payload: buildVideoVisibilityChangedNotification(baseArgs),
      eventId,
    });
    return;
  }

  if (forceNotify) {
    await enqueueNotification(db, {
      discordUserId: args.discordUserId,
      type: "video_status_changed",
      dedupeKey: `video_status_changed:${args.videoId}:${status}`,
      payload: buildVideoVisibilityChangedNotification(baseArgs),
      eventId,
      force: true,
    });
  }
}
