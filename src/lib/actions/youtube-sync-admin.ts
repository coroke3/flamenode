"use server";
import { auditAction } from "@/lib/audit/helpers";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDatabase } from "@/lib/cloudflare";
import { videos, videoYoutubeMetadata } from "@/lib/db/schema";

export async function queueYoutubeMetadataResync(
  formData: FormData,
): Promise<void> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    throw new Error("管理者権限が必要です。");
  }

  const videoId = String(formData.get("video_id") ?? "").trim();
  if (!videoId) throw new Error("対象作品が指定されていません。");

  const db = getDatabase();
  if (!db) throw new Error("DB に接続できません。");

  const video = (
    await db
      .select({
        id: videos.id,
        youtube_video_id: videos.youtube_video_id,
      })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1)
  )[0];
  if (!video) throw new Error("作品が見つかりません。");

  const before = (
    await db
      .select()
      .from(videoYoutubeMetadata)
      .where(eq(videoYoutubeMetadata.video_id, videoId))
      .limit(1)
  )[0] ?? null;
  const now = Math.floor(Date.now() / 1000);

  await db
    .insert(videoYoutubeMetadata)
    .values({
      video_id: videoId,
      youtube_video_id: video.youtube_video_id,
      sync_status: "pending",
      sync_error: null,
      view_count: 0,
      synced_at: null,
      updated_at: now,
    })
    .onConflictDoNothing();

  await db
    .update(videoYoutubeMetadata)
    .set({
      youtube_video_id: video.youtube_video_id,
      sync_status: "pending",
      sync_error: null,
      synced_at: null,
      updated_at: now,
    })
    .where(eq(videoYoutubeMetadata.video_id, videoId));

  await auditAction(db, {
    table_name: "video_youtube_metadata",
    record_id: videoId,
    action: before ? "UPDATE" : "CREATE",
    before_data: before
      ? JSON.stringify({
          sync_status: before.sync_status,
          sync_error: before.sync_error,
          synced_at: before.synced_at,
        })
      : null,
    after_data: JSON.stringify({
      youtube_video_id: video.youtube_video_id,
      sync_status: "pending",
      sync_error: null,
      requested_by: "admin_youtube_sync",
    }),
    operator_discord_id: user.id,
    retention_class: "normal",
  });

  revalidatePath("/admin/youtube-sync");
  revalidatePath(`/admin/videos/${videoId}`);
  revalidatePath(`/${video.youtube_video_id ?? videoId}`);
}
