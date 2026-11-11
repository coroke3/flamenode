import { eq } from "drizzle-orm";
import { videos } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";

/**
 * SA-082..084 minimal scoped video read shared by CURRENT and future Hono.
 * Reading this row does not grant permissions: hosts MUST perform their own
 * authenticated video.permissions authorization before any mutation.
 */
export async function loadPermissionVideoRow(db: ServerCoreDb, videoId: string) {
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      primary_event_id: videos.primary_event_id,
      creator_x_user_id: videos.creator_x_user_id,
      submitted_by_user_id: videos.submitted_by_user_id,
      visibility_status: videos.visibility_status,
    })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);
  return rows[0] ?? null;
}
