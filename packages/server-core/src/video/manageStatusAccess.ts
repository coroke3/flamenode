/**
 * MIG-0603 U02a: unmounted, read-only CURRENT-parity event status access.
 *
 * Call only AFTER Origin -> Session -> writeGuard(requiredRole:null) ->
 * CostGuard("manage_video_status"). A successful preflight is NOT sufficient
 * to activate an HTTP mutation route: full S3/D1 budget and moderation/audit/
 * R2 fencing remain STOP gates.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { eventStaff, events, videoEvents, videos, xUserAccountLinks, xUsers } from "@flamenode/db/schema";
import { staffRowHasPermissionKey } from "@flamenode/domain/auth/permissions/resolver";
import { EVENT_STAFF_PRESETS, getPresetPermissions } from "@flamenode/domain/auth/permissions/presets";
import { assertCondition } from "../audit/mutate.ts";
import { mergeVideoRebuildEventIds, type SessionUserLike } from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";

// Defend against unbounded joined fan-out in D1. Exceeding this limit is
// an explicit fail-closed condition, never a partial-grant decision.
export const MANAGE_VIDEO_STATUS_STAFF_ROW_LIMIT = 256;
// Keep in sync with MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS in staticRebuild/hooks.
// This module deliberately does NOT import the much larger queue/planner chain.
export const MAX_MANAGE_STATUS_REBUILD_EVENTS = 8;
// Both UTF-16 code units and UTF-8 bytes are bounded: a multibyte imported
// event ID must not silently bypass the queue/rebuild input safety limit.
export const MAX_MANAGE_STATUS_EVENTS_JSON_LENGTH = 4096;

function exceedsRebuildIdBytes(value: string): boolean {
  return value.length > MAX_MANAGE_STATUS_EVENTS_JSON_LENGTH ||
    new TextEncoder().encode(value).byteLength > MAX_MANAGE_STATUS_EVENTS_JSON_LENGTH;
}

export type ManageVideoStatusAccess =
  | { ok: true }
  | { ok: false; message: string };

// The complete row is required for the future audited transition planner:
// it checks expectedRowCondition on every original field, not only status.
// This opt-in read is NEVER returned in the active HTTP response.
export type ManageVideoStatusSnapshot =
  | { ok: true; video: typeof videos.$inferSelect; rebuildEventIds: string[] }
  | { ok: false; message: string };

/** Reuse the same bounded projection for the unmounted admin/manage planners. */
function boundedVideoRebuildEventIdsJson(videoId: string) {
  return sql<string>`(
    SELECT COALESCE(json_group_array(linked.event_id), '[]')
    FROM (
      SELECT "event_id" FROM "video_events"
      WHERE "video_id" = ${videoId}
      ORDER BY "event_id"
      LIMIT ${MAX_MANAGE_STATUS_REBUILD_EVENTS + 1}
    ) linked
  )`;
}

function finishVideoStatusSnapshot(
  target: { video: typeof videos.$inferSelect; rebuildEventIdsJson: string },
): ManageVideoStatusSnapshot {
  // Fail closed on malformed aggregates and unexpectedly large imported IDs;
  // do not pass an incomplete rebuild fan-out to a future audited planner.
  const raw = target.rebuildEventIdsJson;
  if (typeof raw !== "string" || exceedsRebuildIdBytes(raw)) {
    throw new Error("manage_status_rebuild_event_snapshot_invalid");
  }
  let linked: unknown;
  try {
    linked = JSON.parse(raw);
  } catch {
    throw new Error("manage_status_rebuild_event_snapshot_invalid");
  }
  if (!Array.isArray(linked) ||
      linked.length > MAX_MANAGE_STATUS_REBUILD_EVENTS + 1 ||
      !linked.every((value) => typeof value === "string")) {
    throw new Error("manage_status_rebuild_event_snapshot_invalid");
  }
  // The JSON bound does not cover videos.primary_event_id. Imported data may
  // contain a very large primary ID even with zero linked rows. Guard that
  // independent input before constructing the queue/rebuild target list.
  const primaryEventId = target.video.primary_event_id;
  if (primaryEventId != null &&
      (typeof primaryEventId !== "string" ||
       exceedsRebuildIdBytes(primaryEventId))) {
    throw new Error("manage_status_rebuild_event_snapshot_invalid");
  }
  const rebuildEventIds = mergeVideoRebuildEventIds(primaryEventId, linked);
  if (rebuildEventIds.length > MAX_MANAGE_STATUS_REBUILD_EVENTS) {
    return { ok: false, message: "関連イベント数が処理上限を超えています。" };
  }
  return { ok: true, video: target.video, rebuildEventIds };
}

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
  // CURRENT loadVideoRebuildEventIds performs one more D1 SELECT after
  // fetching the target. This bounded correlated JSON projection folds the
  // link fan-out into the same already-authorized exact association read.
  // The +1 row is essential: rejecting overflow must never silently discard
  // affected rebuild events. No Queue, R2, audit or mutation is performed.
  const rebuildEventIdsJson = boundedVideoRebuildEventIdsJson(videoId);
  const target = (
    await db
      .select({ video: videos, rebuildEventIdsJson })
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
  return finishVideoStatusSnapshot(target);
}


/**
 * Future site-admin status planner preload (UNMOUNTED, read-only).
 * CURRENT's admin action separately selects the video and its rebuild event
 * IDs. This combines both into one bounded D1 statement, without relaxing the
 * upstream Origin / Session / TOS / CostGuard or audited-write requirements.
 * The site-admin role is checked here too: direct callers must not read a
 * target video before the shared middleware verifies the identity.
 */
export async function loadAdminVideoStatusSnapshot(
  db: ServerCoreDb,
  user: SessionUserLike,
  videoId: string,
): Promise<ManageVideoStatusSnapshot> {
  if (user.role !== "admin") {
    return { ok: false, message: "管理者権限が必要です。" };
  }
  const target = (
    await db
      .select({
        video: videos,
        rebuildEventIdsJson: boundedVideoRebuildEventIdsJson(videoId),
      })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1)
  )[0];
  if (!target) {
    return { ok: false, message: "対象作品が見つかりません。" };
  }
  return finishVideoStatusSnapshot(target);
}


/**
 * Design-only, UNMOUNTED preMutationAssertion candidate for Issue #692.
 *
 * This statement MUST be the FIRST assertion inside the SAME atomic audited
 * D1 batch that writes the new status, audit and outbox. A successful
 * preflight query is not a durable grant: staff/X links and the exact
 * video_event association can all change before the mutation begins.
 *
 * This is a narrowly scoped DB assertion, NOT an approved HTTP auth design:
 * the separate session/TOS/CostGuard budgets and actor snapshot remain
 * unresolved. Do not mount a route or wire into production on this basis.
 */
export function planManageVideoStatusCommitAssertion(
  db: ServerCoreDb,
  user: SessionUserLike,
  eventId: string,
  videoId: string,
) {
  // Derive presets from the canonical permission definitions, rather than
  // allowing a diverging hand-maintained list in the SQL commit fence.
  const statusPresets = EVENT_STAFF_PRESETS.filter((preset) =>
    getPresetPermissions(preset).includes("video.status"),
  );

  // Custom grants are arrays of permission-key strings. SQL must reject
  // malformed JSON and scalar JSON exactly as the canonical JS resolver does.
  // Nested CASE prevents json_type() from touching invalid JSON.
  const safeKeysJson = sql`CASE WHEN json_valid(${eventStaff.custom_permission_keys_json})
    THEN CASE WHEN json_type(${eventStaff.custom_permission_keys_json}) = 'array'
      THEN ${eventStaff.custom_permission_keys_json} ELSE '[]' END
    ELSE '[]' END`;
  const hasCurrentStatusGrant = user.role === "admin"
    ? sql`1 = 1`
    : sql`EXISTS (
      SELECT 1 FROM ${eventStaff}
      INNER JOIN ${xUserAccountLinks}
        ON ${eventStaff.x_user_id} = trim(${xUserAccountLinks.x_user_id})
      INNER JOIN ${xUsers}
        ON ${xUsers.id} = ${xUserAccountLinks.x_user_id}
      WHERE ${eventStaff.event_id} = ${eventId}
        AND ${xUserAccountLinks.auth_user_id} = ${user.id}
        AND ${xUsers.approval_status} = 'approved'
        AND (
          ${inArray(eventStaff.permission_preset, statusPresets)}
          OR (
            ${eventStaff.permission_preset} = 'custom'
            AND EXISTS (
              SELECT 1 FROM json_each(${safeKeysJson}) AS key
              WHERE key.type = 'text' AND key.value = 'video.status'
            )
          )
        )
    )`;
  const targetStillLinked = sql`EXISTS (
    SELECT 1 FROM ${videoEvents}
    INNER JOIN ${videos} ON ${videos.id} = ${videoEvents.video_id}
    INNER JOIN ${events} ON ${events.id} = ${videoEvents.event_id}
    WHERE ${videoEvents.event_id} = ${eventId}
      AND ${videoEvents.video_id} = ${videoId}
  )`;
  return db.run(assertCondition(sql`${hasCurrentStatusGrant} AND ${targetStillLinked}`));
}
