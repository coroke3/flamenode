/**
 * MIG-0652 U01: framework-neutral CURRENT event "slots" update fields.
 *
 * CURRENT's Zod form input and section authorization stay in the caller.
 * Reuse the existing canonical event parts normalizer without duplicating it.
 */
import { buildPartsJson } from "./parts.ts";

export type SlotsEventUpdateInput = {
  max_slots_per_video: number;
  max_slot_reservation_groups_per_xid: number;
  slot_interval_minutes?: number | null;
  slot_part_gap_minutes: number;
  slot_type: "time" | "count";
  slot_visibility_mode: "public_name" | "anonymous" | "hidden";
  parts_text?: string | null;
};

/** Exact field projection used by CURRENT, with no database or network I/O. */
export function buildSlotsEventUpdateFields(data: SlotsEventUpdateInput) {
  return {
    max_slots_per_video: data.max_slots_per_video,
    max_slot_reservation_groups_per_xid:
      data.max_slot_reservation_groups_per_xid,
    slot_interval_minutes: data.slot_interval_minutes ?? null,
    slot_part_gap_minutes: data.slot_part_gap_minutes,
    slot_type: data.slot_type,
    slot_visibility_mode: data.slot_visibility_mode,
    parts_json: buildPartsJson(data.parts_text),
  };
}
