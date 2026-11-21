import { videos, videoYoutubeMetadata } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";
import type { UnslottedVideoAtomicPlan } from "./unslottedEventPlans.ts";

/**
 * SA-086: one videos INSERT and its strict CREATE audit snapshot.
 * Pure D1 batch preparation only: no write happens before the caller's
 * mutateWithAudit/executeVideoAtomicWritePlan transaction.
 */
export function buildFreeVideoInsertPlan(
  db: ServerCoreDb,
  videoAfter: typeof videos.$inferSelect,
  actorUserId: string,
): UnslottedVideoAtomicPlan {
  return {
    statements: [db.insert(videos).values(videoAfter)],
    expectedChanges: [1],
    audits: [{
      table_name: "videos",
      target_id: videoAfter.id,
      operation: "CREATE",
      before: null,
      after: { ...videoAfter },
      actor_user_id: actorUserId,
      context: "video-save:create-free",
      retention_class: "normal",
      strict: true,
    }],
  };
}

/**
 * MIG-0651 SA-086: new video's pending YouTube sync metadata must be written
 * in the SAME atomic batch as videos INSERT. The YouTube ID canonical value
 * lives only on videos.youtube_video_id; derived metadata starts pending.
 *
 * This function never queries/mutates D1 on its own. The caller's strict
 * audit + batch wrapper must own atomic execution and Queue wake.
 */
export function buildFreeVideoYoutubeMetadataInsertPlan(
  db: ServerCoreDb,
  args: { videoId: string; actorUserId: string; now: number },
): UnslottedVideoAtomicPlan {
  const { videoId, actorUserId, now } = args;
  if (!videoId || !actorUserId || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("free_video_youtube_metadata_plan_invalid");
  }
  const row: typeof videoYoutubeMetadata.$inferSelect = {
    video_id: videoId,
    youtube_video_id: null,
    youtube_privacy_status: null,
    youtube_availability_status: null,
    duration_seconds: null,
    view_count: 0,
    synced_at: null,
    sync_status: "pending",
    sync_error: null,
    updated_at: now,
  };
  return {
    statements: [db.insert(videoYoutubeMetadata).values(row)],
    expectedChanges: [1],
    audits: [{
      table_name: "video_youtube_metadata",
      target_id: videoId,
      operation: "CREATE",
      before: null,
      after: { ...row },
      actor_user_id: actorUserId,
      context: "video-save:youtube-metadata",
      retention_class: "normal",
      strict: true,
    }],
  };
}
