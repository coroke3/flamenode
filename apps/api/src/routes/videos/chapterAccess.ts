/**
 * MIG-0603 U02b: who may administer chapters of a video ("video.chapter_admin").
 * CURRENT: src/lib/auth/ownership.ts canEditVideo with
 * privilegeMode = resolveAdminOrEventVideoPrivilegeMode(role):
 *   - admin role  -> adminPolicyAllows (role only, no D1 read)
 *   - other roles -> eventStaffHasExactVideoPermission (event mode only; the
 *     normal owner mode is deliberately NOT a source, and an admin never falls
 *     back to event permissions or the other way round).
 * The decision functions are the shared @flamenode/domain/video ones. The facts
 * (video_events ids + the approved X ids' staff rows) arrive inside the chapter /
 * video read as two correlated subqueries (ZERO_1102 S3: no extra D1 statements).
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
export const MAX_STAFF_ROWS = 100;

export type AccessFacts = {
  /** video_events ids (at most MAX_ATOMIC_VIDEO_EVENTS rows read). */
  videoEventIds: string[];
  /** event_staff rows of the approved X ids on the primary / video_events events. */
  staffRows: Array<{
    event_id: string;
    permission_preset: string | null;
    custom_permission_keys_json: string | null;
  }>;
};

/** Trimmed, de-duplicated approved X ids. */
function normalizeApproved(approvedXIds: readonly string[]): string[] {
  return Array.from(new Set(approvedXIds.map((id) => String(id).trim()).filter(Boolean)));
}

/** The approved X ids the staff subquery matches (admin never reads staff: empty list). */
export function approvedXIdsJson(role: string | null, approvedXIds: readonly string[]): string {
  if (resolveAdminOrEventVideoPrivilegeMode(role) === "admin") return "[]";
  return JSON.stringify(normalizeApproved(approvedXIds));
}

/**
 * Two SELECT-list columns (`ve_json`, `staff_json`) for the video / chapter read.
 * Exactly one bind: the approved X ids JSON (see approvedXIdsJson).
 */
export function accessFactsColumnsSql(videoIdExpr: string, primaryEventExpr: string): string {
  const events = `SELECT "event_id" FROM "video_events" WHERE "video_id" = ${videoIdExpr} ORDER BY "event_id" LIMIT ${MAX_ATOMIC_VIDEO_EVENTS}`;
  return `(SELECT json_group_array("event_id") FROM (${events})) AS ve_json,
              (SELECT json_group_array(json_object('event_id', s."event_id",
                        'permission_preset', s."permission_preset",
                        'custom_permission_keys_json', s."custom_permission_keys_json"))
                 FROM (SELECT "event_id", "permission_preset", "custom_permission_keys_json" FROM "event_staff"
                        WHERE "x_user_id" IN (SELECT CAST(value AS TEXT) FROM json_each(?) WHERE value IS NOT NULL)
                          AND ("event_id" = ${primaryEventExpr} OR "event_id" IN (${events}))
                        LIMIT ${MAX_STAFF_ROWS}) s) AS staff_json`;
}

export function parseAccessFacts(veJson: unknown, staffJson: unknown): AccessFacts {
  const parse = (value: unknown): never[] => {
    if (Array.isArray(value)) return value as never[];
    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : [];
      return Array.isArray(parsed) ? (parsed as never[]) : [];
    } catch {
      return [];
    }
  };
  return { videoEventIds: parse(veJson), staffRows: parse(staffJson) };
}

/** CURRENT loadVideoEventIdsForAccessContext: primary event first, then video_events, capped. */
function eventIdsFor(primary: string | null, facts: AccessFacts): string[] {
  const ids = new Set<string>();
  if (primary) ids.add(primary);
  for (const id of facts.videoEventIds) ids.add(id);
  return Array.from(ids).slice(0, MAX_ATOMIC_VIDEO_EVENTS);
}

export function canAdministerChapters(
  role: string | null,
  approvedXIds: readonly string[],
  video: { primary_event_id: string | null; access: AccessFacts },
): boolean {
  const requiredKey = "video.chapter_admin";
  if (resolveAdminOrEventVideoPrivilegeMode(role) === "admin") {
    return adminPolicyAllows(role, requiredKey);
  }
  if (normalizeApproved(approvedXIds).length === 0) return false;
  const eventIds = eventIdsFor(video.primary_event_id, video.access);
  if (eventIds.length === 0) return false;
  const candidateKeys = Array.from(eventStaffCandidatePermissionKeys(requiredKey));
  if (candidateKeys.length === 0) return false;
  return video.access.staffRows.some((row) => {
    if (!eventIds.includes(row.event_id)) return false;
    const keys = resolveStaffPermissionKeys(row);
    return candidateKeys.some((key) =>
      expandPermissionAliases(key).some((expanded) => keys.has(expanded)),
    );
  });
}
