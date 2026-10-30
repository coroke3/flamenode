import { and, eq, ne } from "drizzle-orm";
import { videos } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";

export function isYoutubeIdUniqueConstraintError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (!message) return false;
  if (!/UNIQUE constraint failed/i.test(message)) return false;
  return (
    /videos\.youtube_video_id/i.test(message) ||
    /videos_youtube_id_active_uniq/i.test(message)
  );
}

/** CURRENT video duplicate predicate; excludes voided video and optionally the edited video. */
export async function checkYoutubeVideoDuplicate(
  db: ServerCoreDb,
  youtubeId: string,
  excludeVideoId?: string,
): Promise<boolean> {
  const row = (
    await db
      .select({ id: videos.id })
      .from(videos)
      .where(
        and(
          eq(videos.youtube_video_id, youtubeId),
          ne(videos.visibility_status, "voided"),
          excludeVideoId ? ne(videos.id, excludeVideoId) : undefined,
        )!,
      )
      .limit(1)
  )[0];
  return Boolean(row);
}
