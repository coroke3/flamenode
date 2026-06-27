import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { videos } from "@/lib/db/schema";

type AnyDb = LibSQLDatabase<any>;

export async function adjustVideoAppLikeCount(
  db: AnyDb,
  videoId: string,
  delta: 1 | -1,
  now: number,
): Promise<void> {
  await db
    .update(videos)
    .set(
      delta === -1
        ? {
            app_like_count: sql<number>`max(0, coalesce(${videos.app_like_count}, 0) - 1)`,
            updated_at: now,
          }
        : {
            app_like_count: sql<number>`coalesce(${videos.app_like_count}, 0) + 1`,
            updated_at: now,
          },
    )
    .where(eq(videos.id, videoId));
}
