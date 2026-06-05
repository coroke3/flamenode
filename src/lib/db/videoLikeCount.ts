import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { isMissingColumnError } from "@/lib/db/queryFallback";
import { videoStats, videos } from "@/lib/db/schema";

type AnyDb = LibSQLDatabase<any>;

/**
 * いいね数を videos.app_like_count で更新する（0024+）。
 * 列が無い旧 DB では video_stats へフォールバックする。
 */
export async function adjustVideoAppLikeCount(
  db: AnyDb,
  videoId: string,
  delta: 1 | -1,
  now: number,
): Promise<void> {
  const videosPatch =
    delta === -1
      ? {
          app_like_count: sql<number>`max(0, coalesce(${videos.app_like_count}, 0) - 1)`,
          updated_at: now,
        }
      : {
          app_like_count: sql<number>`coalesce(${videos.app_like_count}, 0) + 1`,
          updated_at: now,
        };

  try {
    await db.update(videos).set(videosPatch).where(eq(videos.id, videoId));
    return;
  } catch (err) {
    if (!isMissingColumnError(err, "app_like_count")) throw err;
  }

  const statsPatch =
    delta === -1
      ? {
          app_like_count: sql<number>`max(0, coalesce(${videoStats.app_like_count}, 0) - 1)`,
          updated_at: now,
        }
      : {
          app_like_count: sql<number>`coalesce(${videoStats.app_like_count}, 0) + 1`,
          updated_at: now,
        };

  await db
    .update(videoStats)
    .set(statsPatch)
    .where(eq(videoStats.video_id, videoId));
}
