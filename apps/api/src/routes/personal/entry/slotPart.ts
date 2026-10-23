// CURRENT: src/lib/video/slotPart.ts (resolvePartFromSlot), src/lib/video/parseEventIds.ts (parseEventPartsJson),
// src/lib/utils/slotGroupingCore.ts (buildSlotParts). The part INDEX of a slot is computed in SQL (SLOT_PART_CTES: the
// same chronological order, same-day, gap and consecutive sort_order rules, with window functions) so the event slots
// (CURRENT reads them all) never travel to the Worker; this file maps that index to the configured part name.

export function parseEventPartsJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  } catch {
    return [];
  }
}

/** CURRENT resolvePartFromSlot last step: the idx-th configured part name (null when none / out of range). */
export function partNameAt(partsJson: string | null, index: number | null): string | null {
  if (index == null) return null;
  return parseEventPartsJson(partsJson)[index] ?? null;
}

/**
 * CTEs `pgap` / `ps` / `pn` (need CTEs `slot`, `go`, `ev`): `pn.idx` is the 0-based part index of every slot of the
 * slot event, i.e. the buildSlotParts grouping (sort: timed first, start_time, sort_order, id; a new part starts when the
 * JST day, the gap or the consecutive sort_order rule breaks). Empty when the event has no parts_json.
 */
export const SLOT_PART_CTES = `pgap AS (
           SELECT CASE WHEN COALESCE(slot_part_gap_minutes, 15) >= 0 THEN COALESCE(slot_part_gap_minutes, 15) * 60 ELSE 900 END AS sec
           FROM ev
         ),
         ps AS (
           SELECT slots.id AS id, slots.start_time AS st, slots.sort_order AS so, ROW_NUMBER() OVER w AS rn,
             LAG(slots.start_time) OVER w AS pst, LAG(slots.sort_order) OVER w AS pso
           FROM slots
           WHERE EXISTS (SELECT 1 FROM go) AND slots.event_id = (SELECT event_id FROM slot)
             AND (SELECT COALESCE(trim(parts_json), '') FROM ev) <> ''
           WINDOW w AS (ORDER BY slots.start_time IS NULL, COALESCE(slots.start_time, 0), COALESCE(slots.sort_order, 0), slots.id)
         ),
         pn AS (
           SELECT id, SUM(CASE WHEN rn = 1 THEN 0 WHEN (CASE
               WHEN pst IS NOT NULL AND st IS NOT NULL THEN st >= pst
                 AND CAST((st + 32400) / 86400 AS INTEGER) = CAST((pst + 32400) / 86400 AS INTEGER)
                 AND st - pst <= (SELECT sec FROM pgap)
               WHEN pst IS NULL AND st IS NULL THEN pso IS NOT NULL AND so IS NOT NULL AND so = pso + 1
               ELSE 0 END) THEN 0 ELSE 1 END) OVER (ORDER BY rn) AS idx
           FROM ps
         )`;
