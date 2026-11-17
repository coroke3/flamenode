/**
 * MIG-0603 U02a: unmounted authorization boundary for SA-040..042.
 *
 * Call only AFTER the Hono Origin -> Session -> WriteGuard(requiredRole:null)
 * -> CostGuard("manage_video_status") pipeline has succeeded. This helper
 * does not replace those mandatory identity/TOS/ban/cost checks.
 *
 * CURRENT src/lib/actions/manage-video.ts#setManageVideoStatus:
 * site admin OR event staff with video.status, THEN exact video-event link.
 * Neither video submitter nor generic video ownership is an authorization
 * source for event-management status writes.
 */
import { and, eq } from "drizzle-orm";
import { videoEvents } from "@flamenode/db/schema";
import { canEditEvent } from "@flamenode/server-core/auth/ownership";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import type { SessionUserLike } from "@flamenode/domain/video";

export type ManageVideoStatusAccess =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Verify privilege before querying the video-event association: unauthorized
 * callers cannot distinguish an existing foreign video from an absent link.
 * DB errors deliberately propagate to the guarded caller's fixed 503 handler.
 */
export async function checkManageVideoStatusAccess(
  db: ServerCoreDb,
  user: SessionUserLike,
  eventId: string,
  videoId: string,
): Promise<ManageVideoStatusAccess> {
  if (
    user.role !== "admin" &&
    !(await canEditEvent(db, user, eventId, "video.status"))
  ) {
    return { ok: false, message: "このイベントの作品審査権限がありません。" };
  }

  const link = (
    await db
      .select({ video_id: videoEvents.video_id })
      .from(videoEvents)
      .where(
        and(
          eq(videoEvents.event_id, eventId),
          eq(videoEvents.video_id, videoId),
        )!,
      )
      .limit(1)
  )[0];
  if (!link) {
    return { ok: false, message: "このイベントに紐づく作品ではありません。" };
  }
  return { ok: true };
}
