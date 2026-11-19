/**
 * MIG-0603 U02a: unmounted, read-only CURRENT-parity event status access.
 *
 * Call only AFTER Origin -> Session -> writeGuard(requiredRole:null) ->
 * CostGuard("manage_video_status"). A successful preflight is NOT sufficient
 * to activate an HTTP mutation route: full S3/D1 budget and moderation/audit/
 * R2 fencing remain STOP gates.
 */
import { and, eq, sql } from "drizzle-orm";
import { eventStaff, events, videoEvents, videos, xUserAccountLinks, xUsers } from "@flamenode/db/schema";
import { staffRowHasPermissionKey } from "@flamenode/domain/auth/permissions/resolver";
import type { SessionUserLike } from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";

// Defend against unbounded joined fan-out in D1. Exceeding this limit is
// an explicit fail-closed condition, never a partial-grant decision.
export const MANAGE_VIDEO_STATUS_STAFF_ROW_LIMIT = 256;

export type ManageVideoStatusAccess =
  | { ok: true }
  | { ok: false; message: string };

// The complete row is required for the future audited transition planner:
// it checks expectedRowCondition on every original field, not only status.
// This opt-in read is NEVER returned in the active HTTP response.
export type ManageVideoStatusSnapshot =
  | { ok: true; video: typeof videos.$inferSelect }
  | { ok: false; message: string };

/**
 * CURRENT canEditEvent resolves approved linked X IDs, then matches event_staff
 * permission presets/custom keys. Do the same in ONE read using inner joins
 * and the SAME canonical staffRowHasPermissionKey resolver. Importantly:
 * approvedXIdsWhere() trims linked IDs before comparing with event_staff, so
 * this join must trim the linked X ID as well.
 *
 * After privilege succeeds, fetch the exact video-event link separately:
 * an unauthorized request must not discover whether a foreign video exists,
 * nor be exposed to a failure reading video_events before permission denial.
 * The site-admin branch bypasses staff roles, never the association.
 */
async function hasManageVideoStatusGrant(
  db: ServerCoreDb,
  user: SessionUserLike,
  eventId: string,
): Promise<boolean> {
  if (user.role === "admin") return true;
  const approvedStaff = await db
    .select({
      permission_preset: eventStaff.permission_preset,
      custom_permission_keys_json: eventStaff.custom_permission_keys_json,
    })
    .from(eventStaff)
    .innerJoin(
      xUserAccountLinks,
      sql`${eventStaff.x_user_id} = trim(${xUserAccountLinks.x_user_id})`,
    )
    .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .where(
      and(
        eq(eventStaff.event_id, eventId),
        eq(xUserAccountLinks.auth_user_id, user.id),
        eq(xUsers.approval_status, "approved"),
      )!,
    )
    .limit(MANAGE_VIDEO_STATUS_STAFF_ROW_LIMIT + 1);
  if (approvedStaff.length > MANAGE_VIDEO_STATUS_STAFF_ROW_LIMIT) {
    // Do not authorize using an incomplete/oversized permission snapshot.
    // The isolated Hono candidate catches D1/access errors and responds
    // with a private fixed 503, without leaking a target-video association.
    throw new Error("manage_video_status_staff_read_limit_exceeded");
  }
  return approvedStaff.some((row) => staffRowHasPermissionKey(row, "video.status"));
}

/**
 * Existing status candidate: keep its small result and narrow SELECT, so no
 * extra video bytes/CPU are consumed until an audited planner is implemented.
 */
export async function checkManageVideoStatusAccess(
  db: ServerCoreDb,
  user: SessionUserLike,
  eventId: string,
  videoId: string,
): Promise<ManageVideoStatusAccess> {
  if (!(await hasManageVideoStatusGrant(db, user, eventId))) {
    return { ok: false, message: "このイベントの作品審査権限がありません。" };
  }

  const link = (
    await db
      .select({ video_id: videoEvents.video_id })
      .from(videoEvents)
      // An orphaned association is not an authorized video target. The join
      // checks target existence within the SAME single bounded D1 read.
      .innerJoin(videos, eq(videos.id, videoEvents.video_id))
      // Imported/recovered association data can retain a deleted event when
      // foreign-key enforcement was disabled. Do not authorize a status
      // change against a non-existent event; this is the same one D1 read.
      .innerJoin(events, eq(events.id, videoEvents.event_id))
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

// Opt-in S3 planner preload experiment, intentionally NOT mounted in Hono.
// The exact video row is loaded in the already-required event-association
// statement, after staff permission succeeds. This can replace a separate
// planner video SELECT, but is NOT a solution to #692's overall D1 budget or
// to permission revocation between authorization and the audited commit.
export async function loadManageVideoStatusSnapshot(
  db: ServerCoreDb,
  user: SessionUserLike,
  eventId: string,
  videoId: string,
): Promise<ManageVideoStatusSnapshot> {
  if (!(await hasManageVideoStatusGrant(db, user, eventId))) {
    return { ok: false, message: "このイベントの作品審査権限がありません。" };
  }
  const target = (
    await db
      .select({ video: videos })
      .from(videoEvents)
      .innerJoin(videos, eq(videos.id, videoEvents.video_id))
      .innerJoin(events, eq(events.id, videoEvents.event_id))
      .where(
        and(
          eq(videoEvents.event_id, eventId),
          eq(videoEvents.video_id, videoId),
        )!,
      )
      .limit(1)
  )[0];
  if (!target) {
    return { ok: false, message: "このイベントに紐づく作品ではありません。" };
  }
  return { ok: true, video: target.video };
}
