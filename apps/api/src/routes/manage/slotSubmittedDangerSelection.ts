/**
 * MIG-0656 U03a: read-only / UNMOUNTED SA-056/057 submitted-slot selection.
 *
 * CURRENT: src/lib/actions/slot-admin-danger.ts. SA-056 force-releases
 * submitted rows to available, clearing owner and video; SA-057 removes the
 * video but retains the reservation. Neither deletes the video record.
 *
 * This is ONLY a post-authorization snapshot validator. A future handler MUST
 * use Origin-first session + TOS/writeGuard + CostGuard + event.slots permission
 * BEFORE interpreting existence, then atomically recheck raw group membership,
 * slot snapshots, video snapshot and ALL submitted video references in the
 * SAME D1 mutateWithAudit batch. Never use this read-time detach decision
 * without same-batch reference-count and CAS assertions.
 */
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";
import { resolveSlotReservationSubject } from "@flamenode/domain/slots/reservationGroups";
import type { SlotLabelWriteRow } from "./slotWriteScopedRead.ts";

export type SubmittedDangerKind = "force-release" | "keep-reservation";
export type SubmittedVideoBefore = {
  id: string;
  scheduling_type: string | null;
  updated_at: number;
};
export type SubmittedDangerSelection =
  | {
      ok: true;
      rows: SlotLabelWriteRow[];
      groupId: string | null;
      videoId: string | null;
      videoBefore: SubmittedVideoBefore | null;
      shouldDetachVideoSchedulingAtRead: boolean;
    }
  | { ok: false; message: string };

const CHANGED = "提出グループの状態が変わりました。画面を更新して再試行してください。";
const MIXED = "提出グループの予約情報または作品が一致しないため中止しました。";

function completeRow(row: unknown, eventId: string): row is SlotLabelWriteRow {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const r = row as Record<string, unknown>;
  const nullableText = [
    "reserved_by_user_id", "x_user_id", "reserved_x_id_snapshot",
    "display_name", "slot_label", "reservation_group_id", "video_id",
  ];
  return typeof r.id === "string" && !!r.id.trim() && r.id === r.id.trim() &&
    r.event_id === eventId && r.status === "submitted" &&
    Number.isSafeInteger(r.version) && (r.version as number) >= 0 &&
    Number.isSafeInteger(r.updated_at) && Number.isSafeInteger(r.sort_order) &&
    (r.start_time === null || Number.isSafeInteger(r.start_time)) &&
    nullableText.every(key => r[key] === null || typeof r[key] === "string");
}

export function selectSubmittedDangerSnapshot(input: {
  kind: SubmittedDangerKind;
  eventId: string;
  slotId: string;
  anchor: SlotLabelWriteRow | null;
  /** Up to 21 rows with the anchor's exact RAW group key, including sentinel. */
  groupedRows: readonly SlotLabelWriteRow[];
  /** Not looked up when anchor.video_id is blank for SA-056. */
  videoBefore: SubmittedVideoBefore | null;
  /** Up to 21 rows with matching video_id and status submitted. */
  submittedVideoRefs: readonly { id: string }[];
}): SubmittedDangerSelection {
  const { kind, eventId, slotId, anchor } = input;
  if ((kind !== "force-release" && kind !== "keep-reservation") ||
      typeof eventId !== "string" || !eventId.trim() ||
      eventId !== eventId.trim() || typeof slotId !== "string" ||
      !slotId.trim() || slotId !== slotId.trim()) {
    return { ok: false, message: CHANGED };
  }
  if (!anchor) return { ok: false, message: "対象の枠が見つかりません。" };
  if (!completeRow(anchor, eventId) || anchor.id !== slotId) {
    return { ok: false, message: CHANGED };
  }

  const rawGroup = anchor.reservation_group_id;
  // CURRENT uses JS trim() to classify a group, then exact stored equality
  // to select its members. SQLite trim() is NOT Unicode-equivalent.
  const groupId = rawGroup?.trim() || null;
  const rows = groupId ? [...input.groupedRows] : [anchor];
  if (rows.length < 1 || rows.length > MAX_SLOTS_PER_VIDEO ||
      (groupId && !rows.some(row => row.id === slotId))) {
    return { ok: false, message: CHANGED };
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (!completeRow(row, eventId) || seen.has(row.id) ||
        (groupId !== null && row.reservation_group_id !== rawGroup)) {
      return { ok: false, message: CHANGED };
    }
    seen.add(row.id);
    if (row.reserved_by_user_id !== anchor.reserved_by_user_id ||
        row.x_user_id !== anchor.x_user_id ||
        row.reserved_x_id_snapshot !== anchor.reserved_x_id_snapshot ||
        row.display_name !== anchor.display_name ||
        row.video_id !== anchor.video_id) {
      return { ok: false, message: MIXED };
    }
  }
  const matchedAnchor = rows.find(row => row.id === slotId);
  if (!matchedAnchor || matchedAnchor.version !== anchor.version ||
      matchedAnchor.updated_at !== anchor.updated_at ||
      matchedAnchor.reserved_by_user_id !== anchor.reserved_by_user_id ||
      matchedAnchor.video_id !== anchor.video_id) {
    return { ok: false, message: CHANGED };
  }

  if (kind === "keep-reservation") {
    // Reuse CURRENT SA-057's strict reservation subject validator.
    const resolved = resolveSlotReservationSubject(
      rows.map(row => ({ ...row, status: "submitted" as const })),
    );
    if (!resolved.ok || resolved.subject.reservedByUserId !==
        anchor.reserved_by_user_id?.trim()) {
      return { ok: false, message: "提出グループの予約情報が不整合なため中止しました。" };
    }
  }

  const videoId = anchor.video_id?.trim() || null;
  if (!videoId) {
    if (kind === "keep-reservation") {
      return { ok: false, message: "提出済み枠に紐づく作品が見つかりません。" };
    }
    return {
      ok: true, rows, groupId, videoId: null,
      videoBefore: null, shouldDetachVideoSchedulingAtRead: false,
    };
  }
  const video = input.videoBefore;
  if (!video || video.id !== videoId ||
      !Number.isSafeInteger(video.updated_at)) {
    return { ok: false, message: "提出済み枠に紐づく作品が見つからないため中止しました。" };
  }

  const refs = input.submittedVideoRefs;
  if (!Array.isArray(refs) || refs.length > MAX_SLOTS_PER_VIDEO ||
      refs.some(ref => !ref || typeof ref.id !== "string" || !ref.id.trim()) ||
      new Set(refs.map(ref => ref.id)).size !== refs.length) {
    return { ok: false, message: "作品を参照する提出済み枠が上限を超えているため中止しました。" };
  }
  const refIds = new Set(refs.map(ref => ref.id));
  // Data corruption or an incomplete read should never falsely make the
  // video eligible for manual scheduling. A CAS assertion is still required.
  if (rows.some(row => !refIds.has(row.id))) {
    return { ok: false, message: "作品の提出枠参照が不整合なため中止しました。" };
  }
  const selectedIds = new Set(rows.map(row => row.id));
  return {
    ok: true, rows, groupId, videoId, videoBefore: video,
    shouldDetachVideoSchedulingAtRead:
      video.scheduling_type === "slotted" &&
      refs.every(ref => selectedIds.has(ref.id)),
  };
}
