/** MIG-0722 U01 (D-17-7): bounded read only; write APIs are owned by MIG-0656. */
import { ManageSlotsResponseSchema, type ManageSlotsResponse, type ManageSlotRow } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 5; // CURRENT presents up to 500 slots.
export type SlotFilter = ManageSlotsResponse["statusFilter"];
export type ManageSlotsList = ManageSlotsResponse & {
  /** True only when we hit the 500-row cap; it does not prove a 501st row exists. */
  atLimit: boolean;
};

export function normalizeSlotFilter(raw: string | null | undefined): SlotFilter {
  return raw === "available" || raw === "reserved" || raw === "submitted" ? raw : "all";
}

/**
 * Read at most five sequential 100-row pages. Every page must describe the
 * requested event, filter, and offset; a mid-stream error discards ALL rows.
 * The first response is the source of counts and event metadata (D-17-7).
 */
export async function listSlots(
  eventId: string,
  status: string | null | undefined = "all",
  fetchFn: OpsFetch = (path, init) => fetch(path, init),
  signal?: AbortSignal,
): Promise<OpsResult<ManageSlotsList>> {
  if (!eventId || eventId === "." || eventId === ".." || eventId.includes("/") || eventId.includes("\\")) {
    return { status: "unavailable" };
  }
  const filter = normalizeSlotFilter(status);
  const rows: ManageSlotRow[] = [];
  const seen = new Set<string>();
  let first: ManageSlotsResponse | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (signal?.aborted) return { status: "unavailable" };
    const offset = page * PAGE_SIZE;
    const path = "/api/manage/events/" + encodeURIComponent(eventId) +
      "/slots?status=" + filter + "&offset=" + offset;
    const result = await getJson<unknown>(fetchFn, path, signal);
    if (result.status !== "ok") return result;
    const parsed = ManageSlotsResponseSchema.safeParse(result.data);
    if (!parsed.success) return { status: "unavailable" };
    const data = parsed.data;
    if (data.event.id !== eventId || data.offset !== offset || data.pageSize !== PAGE_SIZE ||
        data.statusFilter !== filter || data.slots.length > PAGE_SIZE ||
        data.slots.some(slot => slot.event_id !== eventId || (filter !== "all" && slot.status !== filter))) {
      return { status: "unavailable" };
    }
    if (first === null) {
      first = data;
    } else if (data.total !== first.total ||
               JSON.stringify(data.counts) !== JSON.stringify(first.counts) ||
               data.event.title !== first.event.title ||
               data.event.accent_color !== first.event.accent_color ||
               data.event.slot_part_gap_minutes !== first.event.slot_part_gap_minutes ||
               JSON.stringify(data.event.parts) !== JSON.stringify(first.event.parts) ||
               data.isAdmin !== first.isAdmin || data.pendingCount !== first.pendingCount) {
      // Concurrent mutations can change the snapshot; never stitch mixed pages together.
      return { status: "unavailable" };
    }
    for (const slot of data.slots) {
      if (seen.has(slot.id)) return { status: "unavailable" };
      seen.add(slot.id);
      rows.push(slot);
    }
    if (data.slots.length < PAGE_SIZE) break;
  }
  if (first === null) return { status: "unavailable" };
  return { status: "ok", data: { ...first, slots: rows, offset: 0, atLimit: rows.length === MAX_PAGES * PAGE_SIZE } };
}
