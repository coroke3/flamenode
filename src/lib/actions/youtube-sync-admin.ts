"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { videos, videoYoutubeMetadata } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import { sendYoutubeSyncPendingWakeBestEffort } from "@/lib/queues/youtubeSyncWake";
import type { QueueWakeKind } from "@/lib/queues/wakeBudget";

function revalidateYoutubeSyncPaths(videoId: string, youtubeVideoId: string | null): void {
  revalidatePath("/admin/youtube-sync");
  revalidatePath(`/admin/videos/${videoId}`);
  revalidatePath(`/${youtubeVideoId ?? videoId}`);
}

async function revalidateYoutubeSyncPathsBestEffort(
  videoId: string,
  youtubeVideoId: string | null,
): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "admin_youtube_sync", traceId: createTraceId() },
    [
      {
        name: "revalidate_youtube_sync_paths",
        run: async () => {
          revalidateYoutubeSyncPaths(videoId, youtubeVideoId);
        },
      },
    ],
  );
}

export async function queueYoutubeMetadataResync(formData: FormData): Promise<void> {
  const guard = await requireAdminWrite("admin_youtube_sync");
  if (!guard.ok) throw new Error(guard.message);
  const videoId = String(formData.get("video_id") ?? "").trim();
  if (!videoId || videoId.length > 128) throw new Error("対象作品が不正です。");
  const { db } = guard;
  const video = (await db.select().from(videos).where(eq(videos.id, videoId)).limit(1))[0];
  if (!video) throw new Error("作品が見つかりません。");
  const before = (await db.select().from(videoYoutubeMetadata).where(eq(videoYoutubeMetadata.video_id, videoId)).limit(1))[0] ?? null;
  if (before?.sync_status === "pending") {
    return;
  }
  const now = Math.max(Math.floor(Date.now() / 1000), (before?.updated_at ?? 0) + 1);
  const after: typeof videoYoutubeMetadata.$inferSelect = before
    ? { ...before, sync_status: "pending", sync_error: null, synced_at: null, updated_at: now }
    : { video_id: videoId, youtube_privacy_status: null, youtube_availability_status: null, duration_seconds: null, view_count: 0, synced_at: null, sync_status: "pending", sync_error: null, updated_at: now };
  const statement = before
    ? db.update(videoYoutubeMetadata).set({ sync_status: "pending", sync_error: null, synced_at: null, updated_at: now }).where(and(eq(videoYoutubeMetadata.video_id, videoId), expectedRowCondition({ expectedCurrent: { ...before } }))!)
    : db.insert(videoYoutubeMetadata).values(after);
  const wakeSentKinds = new Set<QueueWakeKind>();
  try {
    await mutateWithAudit(db, {
      mutationStatements: [statement],
      expectedMutationChanges: 1,
      audits: [{ table_name: "video_youtube_metadata", target_id: videoId, operation: before ? "UPDATE" : "CREATE", before: before ? { ...before } : null, after: { ...after }, actor_user_id: guard.user.id, context: "admin_youtube_sync", reason: "YouTubeメタデータ再同期を予約", retention_class: "normal", strict: true }],
      wakeSentKinds,
    });
    await sendYoutubeSyncPendingWakeBestEffort("admin", wakeSentKinds);
  } catch (error) {
    unstable_rethrow(error);
    throw error;
  }
  await revalidateYoutubeSyncPathsBestEffort(videoId, video.youtube_video_id);
}
