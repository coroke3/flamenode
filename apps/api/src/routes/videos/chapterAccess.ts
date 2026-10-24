/**
 * MIG-0603 U02b: who may administer chapters of a video ("video.chapter_admin").
 * CURRENT: src/lib/auth/ownership.ts canEditVideo with
 * privilegeMode = resolveAdminOrEventVideoPrivilegeMode(role):
 *   - admin role  -> adminPolicyAllows (role only, no D1 read)
 *   - other roles -> eventStaffHasExactVideoPermission (event mode only; the
 *     normal owner mode is deliberately NOT a source, and an admin never falls
 *     back to event permissions or the other way round).
 * The decision functions are the shared @flamenode/domain/video ones; only the
 * two reads are raw D1 (2 statements: the video's events, then the staff rows).
 */
import {
  adminPolicyAllows,
  eventStaffCandidatePermissionKeys,
  resolveAdminOrEventVideoPrivilegeMode,
} from "@flamenode/domain/video";
import { expandPermissionAliases } from "@flamenode/domain/auth/permissions";
import { resolveStaffPermissionKeys } from "../manage/access.ts";

/** CURRENT MAX_ATOMIC_VIDEO_EVENTS (src/lib/video/atomicLimits.ts). */
const MAX_ATOMIC_VIDEO_EVENTS = 4;
/** ZERO_1102 S2: LIMIT <= 100. CURRENT is unbounded; see the work item (fail closed). */
const MAX_STAFF_ROWS = 100;

type StaffRow = {
  permission_preset: string | null;
  custom_permission_keys_json: string | null;
};

/** CURRENT loadVideoEventIdsForAccessContext: primary event first, then video_events, capped. */
async function loadVideoEventIds(
  db: D1Database,
  video: { id: string; primary_event_id: string | null },
): Promise<string[]> {
  const ids = new Set<string>();
  if (video.primary_event_id) ids.add(video.primary_event_id);
  const { results } = await db
    .prepare(
      `SELECT "event_id" FROM "video_events" WHERE "video_id" = ? LIMIT ${MAX_ATOMIC_VIDEO_EVENTS + 1}`,
    )
    .bind(video.id)
    .all<{ event_id: string }>();
  for (const row of results) ids.add(row.event_id);
  return Array.from(ids).slice(0, MAX_ATOMIC_VIDEO_EVENTS);
}

export async function canAdministerChapters(
  db: D1Database,
  role: string | null,
  approvedXIds: readonly string[],
  video: { id: string; primary_event_id: string | null },
): Promise<boolean> {
  const requiredKey = "video.chapter_admin";
  if (resolveAdminOrEventVideoPrivilegeMode(role) === "admin") {
    return adminPolicyAllows(role, requiredKey);
  }
  const approved = Array.from(
    new Set(approvedXIds.map((id) => String(id).trim()).filter(Boolean)),
  );
  if (approved.length === 0) return false;
  const eventIds = await loadVideoEventIds(db, video);
  if (eventIds.length === 0) return false;
  const candidateKeys = Array.from(eventStaffCandidatePermissionKeys(requiredKey));
  if (candidateKeys.length === 0) return false;

  const { results } = await db
    .prepare(
      `SELECT "permission_preset", "custom_permission_keys_json" FROM "event_staff"
       WHERE "event_id" IN (${eventIds.map(() => "?").join(", ")})
         AND "x_user_id" IN (
           SELECT CAST(value AS TEXT) FROM json_each(?) WHERE value IS NOT NULL
         )
       LIMIT ${MAX_STAFF_ROWS}`,
    )
    .bind(...eventIds, JSON.stringify(approved))
    .all<StaffRow>();
  return results.some((row) => {
    const keys = resolveStaffPermissionKeys(row);
    return candidateKeys.some((key) =>
      expandPermissionAliases(key).some((expanded) => keys.has(expanded)),
    );
  });
}
