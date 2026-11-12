/**
 * MIG-0656 U02c-5c: SA-060 single-slot force-release notification plan.
 * Offline-only / UNMOUNTED. A single CURRENT releaseSlot() operation
 * sends at most one DM for one complete raw reservation group (<=20), or
 * one solo slot. The existing SA-063 3-row default remains unchanged.
 *
 * Returned SQL belongs in postAuditStatements of the SAME strict audited
 * mutateWithAudit batch as SA-060 group assertion, CAS DML and queue rows.
 * Zero immediate wake per D-0603-1 / D-13-41.
 */
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";
import type { SlotReleaseSnapshotRow } from "./slotWriteAssertions.ts";
import {
  buildSlotReleaseOutboxStatements,
  type SlotReleaseNotificationPlan,
} from "./slotReleaseOutbox.ts";

export function buildSlotSingleReleaseOutboxStatements(input: {
  eventId: string;
  rows: readonly SlotReleaseSnapshotRow[];
  siteOrigin: string;
  createdAt: number;
  makeId?: () => string;
}): SlotReleaseNotificationPlan {
  const rows = input.rows;
  if (!input.eventId || input.eventId !== input.eventId.trim() ||
      rows.length < 1 || rows.length > MAX_SLOTS_PER_VIDEO) {
    throw new Error("slot_single_release_notification_invalid_input");
  }
  const anchor = rows[0]!;
  const rawGroup = anchor.reservation_group_id;
  const activeGroup = rawGroup?.trim() ? rawGroup : null;
  if (!activeGroup && rows.length !== 1) {
    throw new Error("slot_single_release_notification_invalid_group");
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.id.trim() ||
        row.id !== row.id.trim() || seen.has(row.id) ||
        row.event_id !== input.eventId || row.status !== "reserved" ||
        !Number.isSafeInteger(row.version) || row.version < 0 ||
        !Number.isSafeInteger(row.updated_at) ||
        row.reserved_by_user_id !== anchor.reserved_by_user_id ||
        row.x_user_id !== anchor.x_user_id ||
        (activeGroup !== null && row.reservation_group_id !== rawGroup)) {
      throw new Error("slot_single_release_notification_invalid_snapshot");
    }
    seen.add(row.id);
  }
  return buildSlotReleaseOutboxStatements({ ...input, maxRows: 20 });
}
