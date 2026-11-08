/**
 * MIG-0656 U03c: SA-056/057 submitted group atomic SQL candidates.
 * UNMOUNTED / offline-only. Execute ONLY inside one mutateWithAudit D1 batch,
 * with full slot + video strict long audits, notification Outbox and rebuild
 * intents. CURRENT source: src/lib/actions/slot-admin-danger.ts.
 *
 * The preconditions recheck exact RAW group membership, every 14-field slot
 * snapshot, the video updated_at/scheduling_type and the COMPLETE set of
 * submitted references before any DML. No route, remote D1 or Queue writes.
 */
import { sql, type SQL } from "@flamenode/server-core/sql";
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";
import type { SubmittedDangerKind, SubmittedDangerSelection } from "./slotSubmittedDangerSelection.ts";

export type SubmittedDangerAtomicPlan = {
  preMutationAssertions: SQL[];
  mutationStatements: SQL[];
  expectedMutationChanges: number[];
  affectedSlotIds: string[];
  /** A candidate mutation, NOT a complete video long-audit before image. */
  updatesVideoScheduling: boolean;
};

const FIELDS = [
  "id","event_id","reserved_by_user_id","x_user_id",
  "reserved_x_id_snapshot","display_name","slot_label","start_time",
  "sort_order","reservation_group_id","video_id","status",
  "updated_at","version",
] as const;

export function buildSubmittedDangerAtomicPlan(input: {
  kind: SubmittedDangerKind;
  eventId: string;
  selection: SubmittedDangerSelection;
  updatedAt: number;
}): SubmittedDangerAtomicPlan {
  const { kind, eventId, selection, updatedAt } = input;
  if ((kind !== "force-release" && kind !== "keep-reservation") ||
      typeof eventId !== "string" || !eventId.trim() ||
      eventId !== eventId.trim() ||
      !Number.isSafeInteger(updatedAt) || updatedAt < 0 ||
      !selection?.ok || !Array.isArray(selection.rows) ||
      selection.rows.length < 1 || selection.rows.length > MAX_SLOTS_PER_VIDEO) {
    throw Error("slot_submitted_danger_invalid_selection");
  }
  const { rows } = selection;
  const anchor = rows[0];
  const activeRawGroup = anchor.reservation_group_id?.trim()
    ? anchor.reservation_group_id : null;
  if (selection.groupId !== (activeRawGroup?.trim() || null) ||
      (!activeRawGroup && rows.length !== 1)) {
    throw Error("slot_submitted_danger_invalid_group");
  }
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.id.trim() ||
        row.id !== row.id.trim() || ids.has(row.id) ||
        row.event_id !== eventId || row.status !== "submitted" ||
        !Number.isSafeInteger(row.version) || row.version < 0 ||
        !Number.isSafeInteger(row.updated_at) ||
        !Number.isSafeInteger(row.sort_order) ||
        (row.start_time !== null && !Number.isSafeInteger(row.start_time)) ||
        row.reservation_group_id !== anchor.reservation_group_id ||
        row.reserved_by_user_id !== anchor.reserved_by_user_id ||
        row.x_user_id !== anchor.x_user_id ||
        row.reserved_x_id_snapshot !== anchor.reserved_x_id_snapshot ||
        row.display_name !== anchor.display_name ||
        row.video_id !== anchor.video_id ||
        ["reserved_by_user_id","x_user_id","reserved_x_id_snapshot",
          "display_name","slot_label","reservation_group_id","video_id"]
          .some(k => row[k as keyof typeof row] !== null &&
            typeof row[k as keyof typeof row] !== "string")) {
      throw Error("slot_submitted_danger_invalid_row");
    }
    ids.add(row.id);
  }
  if (kind === "keep-reservation" &&
      (!anchor.reserved_by_user_id?.trim() || !anchor.x_user_id?.trim())) {
    throw Error("slot_submitted_danger_invalid_subject");
  }

  const videoId = anchor.video_id?.trim() || null;
  if (selection.videoId !== videoId ||
      !Array.isArray(selection.submittedVideoRefIds)) {
    throw Error("slot_submitted_danger_invalid_video_snapshot");
  }
  const refIds = selection.submittedVideoRefIds;
  const uniqueRefIds = new Set(refIds);
  const hasVideo = videoId !== null;
  if ((hasVideo && (!selection.videoBefore ||
        selection.videoBefore.id !== videoId ||
        !Number.isSafeInteger(selection.videoBefore.updated_at) ||
        (selection.videoBefore.scheduling_type !== null &&
          typeof selection.videoBefore.scheduling_type !== "string") ||
        refIds.length < 1 || refIds.length > MAX_SLOTS_PER_VIDEO ||
        refIds.some(id => typeof id !== "string" || !id.trim()) ||
        uniqueRefIds.size !== refIds.length ||
        rows.some(row => !uniqueRefIds.has(row.id)))) ||
      (!hasVideo && (kind === "keep-reservation" ||
        selection.videoBefore !== null || refIds.length !== 0))) {
    throw Error("slot_submitted_danger_invalid_video_snapshot");
  }
  const willDetach = hasVideo &&
    selection.videoBefore!.scheduling_type === "slotted" &&
    refIds.every(id => ids.has(id));
  if (willDetach !== selection.shouldDetachVideoSchedulingAtRead) {
    throw Error("slot_submitted_danger_inconsistent_detach");
  }
  const expected = JSON.stringify(rows.map(row =>
    Object.fromEntries(FIELDS.map(key => [key, row[key]]))));
  const groupKeys = JSON.stringify(activeRawGroup ? [activeRawGroup] : []);
  // Same-D1-batch phantom guard: no other row with the exact raw group may
  // exist, including other statuses or a newly inserted member.
  const membership = sql`
    WITH expected AS (
      SELECT
        json_extract(j.value,'$.id') AS id,
        j.value AS value
      FROM json_each(${expected}) AS j
    ),
    actual AS (
      SELECT s.* FROM slots AS s WHERE s.event_id = ${eventId}
        AND (s.id IN (SELECT id FROM expected)
          OR s.reservation_group_id IN
            (SELECT value FROM json_each(${groupKeys})))
    )
    SELECT CASE WHEN
      (SELECT COUNT(*) FROM actual) = ${rows.length}
      AND (SELECT COUNT(*) FROM actual AS s
        JOIN expected AS e ON s.id = e.id
        WHERE
          s.event_id IS json_extract(e.value,'$.event_id')
          AND s.status IS json_extract(e.value,'$.status')
          AND s.version IS json_extract(e.value,'$.version')
          AND s.updated_at IS json_extract(e.value,'$.updated_at')
          AND s.reservation_group_id IS json_extract(e.value,'$.reservation_group_id')
          AND s.reserved_by_user_id IS json_extract(e.value,'$.reserved_by_user_id')
          AND s.x_user_id IS json_extract(e.value,'$.x_user_id')
          AND s.reserved_x_id_snapshot IS json_extract(e.value,'$.reserved_x_id_snapshot')
          AND s.display_name IS json_extract(e.value,'$.display_name')
          AND s.slot_label IS json_extract(e.value,'$.slot_label')
          AND s.start_time IS json_extract(e.value,'$.start_time')
          AND s.sort_order IS json_extract(e.value,'$.sort_order')
          AND s.video_id IS json_extract(e.value,'$.video_id')
      ) = ${rows.length}
    THEN 1 ELSE json_extract('invalid-submitted-group-snapshot','$') END
  `;
  const preMutationAssertions: SQL[] = [membership];
  if (videoId) {
    const before = selection.videoBefore!;
    const expectedRefs = JSON.stringify(refIds);
    // A video can have submitted rows outside this event; compare all of them
    // without limiting the SQL query. The 21-sentinel was validated on read.
    const refs = sql`
      SELECT CASE WHEN
        (SELECT COUNT(*) FROM videos
          WHERE id = ${videoId} AND updated_at = ${before.updated_at}
            AND scheduling_type IS ${before.scheduling_type}) = 1
        AND (SELECT COUNT(*) FROM slots
          WHERE video_id = ${videoId} AND status = 'submitted') = ${refIds.length}
        AND (SELECT COUNT(*) FROM slots AS s
          JOIN json_each(${expectedRefs}) AS j ON j.value = s.id
          WHERE s.video_id = ${videoId} AND s.status = 'submitted') = ${refIds.length}
      THEN 1 ELSE json_extract('invalid-submitted-video-refs','$') END
    `;
    preMutationAssertions.push(refs);
  }
  const nextStatus = kind === "force-release" ? "available" : "reserved";
  const clearReservation = kind === "force-release";
  const update = clearReservation ? sql`
    UPDATE slots SET status = ${nextStatus},
      reserved_by_user_id = NULL, x_user_id = NULL,
      reserved_x_id_snapshot = NULL, display_name = NULL,
      reservation_group_id = NULL, video_id = NULL,
      updated_at = ${updatedAt}, version = version + 1
    WHERE event_id = ${eventId} AND status = 'submitted'
      AND EXISTS (SELECT 1 FROM json_each(${expected}) AS j
        WHERE json_extract(j.value,'$.id') = slots.id
          AND json_extract(j.value,'$.version') = slots.version
          AND json_extract(j.value,'$.updated_at') = slots.updated_at
          AND json_extract(j.value,'$.reservation_group_id') IS slots.reservation_group_id
          AND json_extract(j.value,'$.reserved_by_user_id') IS slots.reserved_by_user_id
          AND json_extract(j.value,'$.x_user_id') IS slots.x_user_id
          AND json_extract(j.value,'$.reserved_x_id_snapshot') IS slots.reserved_x_id_snapshot
          AND json_extract(j.value,'$.video_id') IS slots.video_id)
  ` : sql`
    UPDATE slots SET status = ${nextStatus}, video_id = NULL,
      updated_at = ${updatedAt}, version = version + 1
    WHERE event_id = ${eventId} AND status = 'submitted'
      AND EXISTS (SELECT 1 FROM json_each(${expected}) AS j
        WHERE json_extract(j.value,'$.id') = slots.id
          AND json_extract(j.value,'$.version') = slots.version
          AND json_extract(j.value,'$.updated_at') = slots.updated_at
          AND json_extract(j.value,'$.reservation_group_id') IS slots.reservation_group_id
          AND json_extract(j.value,'$.reserved_by_user_id') IS slots.reserved_by_user_id
          AND json_extract(j.value,'$.x_user_id') IS slots.x_user_id
          AND json_extract(j.value,'$.reserved_x_id_snapshot') IS slots.reserved_x_id_snapshot
          AND json_extract(j.value,'$.video_id') IS slots.video_id)
  `;
  const mutationStatements: SQL[] = [update];
  const expectedMutationChanges = [rows.length];
  if (willDetach) {
    // Executed AFTER slot UPDATE in the same transaction. The NOT EXISTS
    // guard is the final on-write safeguard against hidden submitted refs.
    const before = selection.videoBefore!;
    mutationStatements.push(sql`
      UPDATE videos SET scheduling_type = 'manual', updated_at = ${updatedAt}
      WHERE id = ${videoId} AND updated_at = ${before.updated_at}
        AND scheduling_type = 'slotted'
        AND NOT EXISTS (SELECT 1 FROM slots
          WHERE video_id = ${videoId} AND status = 'submitted')
    `);
    expectedMutationChanges.push(1);
  }
  return {
    preMutationAssertions, mutationStatements, expectedMutationChanges,
    affectedSlotIds: rows.map(row => row.id),
    updatesVideoScheduling: willDetach,
  };
}
