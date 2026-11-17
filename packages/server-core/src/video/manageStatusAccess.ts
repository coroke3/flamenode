/**
 * MIG-0603 U02a: canonical read-only event-status authorization, shared with
 * the unmounted Hono transport. CURRENT's manage action performs the same
 * checks in the same order (src/lib/actions/manage-video.ts).
 *
 * Caller MUST enforce Origin -> Session -> writeGuard(requiredRole:null) ->
 * CostGuard("manage_video_status") before calling this authorization helper.
 */
import { and, eq } from "drizzle-orm";
import { videoEvents } from "@flamenode/db/schema";
import type { SessionUserLike } from "@flamenode/domain/video";
import { canEditEvent } from "../auth/ownership.ts";
import type { ServerCoreDb } from "../db.ts";

export type ManageVideoStatusAccess =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Deny unauthorized users before fetching target event-video associations
 * (avoid private existence disclosure). Site admins bypass only staff
 * privilege, never the exact video-event link. D1 errors propagate fail-closed.
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
