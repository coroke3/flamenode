/**
 * MIG-0722 U03a: pure transport-intent planner for the nine SA-056..064
 * admin-slot operations. Do NOT construct an HTTP endpoint or issue a write.
 * MIG-0656 #514 currently supplies contracts, not Hono write routes.
 *
 * The backend remains responsible for authorization, CAS/version, audits,
 * transactional side effects, and queue/notification behavior.
 */
import type { SlotGenerateRequest } from "../routes/manage/SlotBatchForm.js";
import type { SlotListOperation } from "../routes/manage/SlotList.js";

type NoBody = Record<string, never>;
export type SlotWriteIntent =
  | { action: "generateSlotsBatch"; eventId: string; body: SlotGenerateRequest }
  | { action: "deleteAvailableSlots"; eventId: string; body: NoBody }
  | { action: "releaseSlot" | "deleteSlot" | "forceReleaseSubmittedSlot" |
      "releaseSubmittedVideoKeepReservation"; eventId: string; slotId: string; body: NoBody }
  | { action: "batchDeleteAvailableSlots" | "batchReleaseReservedSlots";
      eventId: string; body: { slot_ids: string[] } }
  | { action: "batchUpdateSlotLabels"; eventId: string;
      body: { slot_ids: string[]; label: string } };

/** Only valid, single path-segment IDs may eventually be encoded for a URL. */
function validId(id: unknown): id is string {
  if (typeof id !== "string" || id.length === 0 || id !== id.trim() ||
      id === "." || id === ".." || id.includes("/") || id.includes("\\") ||
      id.includes("\0")) return false;
  try { encodeURIComponent(id); return true; } catch { return false; }
}

function validInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= min && value <= max;
}

/** Calendar-validated JST local minute. Never accept Date's rollover normalization. */
function jstMinute(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour > 23 || minute > 59) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, 0, 0);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return null;
  const check = new Date(timestamp);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month ||
      check.getUTCDate() !== day || check.getUTCHours() !== hour ||
      check.getUTCMinutes() !== minute) return null;
  return timestamp / 60000 - 9 * 60;
}

/** Normalize batch IDs exactly as MIG-0656 U01: trim, de-duplicate, then cap at 3. */
function slotIds(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const normalized: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") return null;
    const id = raw.trim();
    if (!validId(id)) return null;
    if (!normalized.includes(id)) normalized.push(id);
    if (normalized.length > 3) return null;
  }
  return normalized.length > 0 ? normalized : null;
}

/** Stages one of the CURRENT 9 action bodies; no route/method is assumed. */
export function planSlotGenerate(
  eventId: string, request: SlotGenerateRequest,
): SlotWriteIntent | null {
  if (!validId(eventId) || !request || typeof request !== "object") return null;
  // CURRENT's batchSchema validates shared fields even for inactive modes.
  // Reject malformed extra fields rather than silently accepting them.
  // MIG-0656 must also enforce this at the authoritative Hono boundary.
  const shared = request as unknown as Record<string, unknown>;
  if ((shared.count !== undefined && !validInteger(shared.count, 1, 100)) ||
      (shared.start_index !== undefined && !validInteger(shared.start_index, 0, 9999)) ||
      (shared.interval_minutes !== undefined &&
        !validInteger(shared.interval_minutes, 1, 1440)) ||
      (shared.label_prefix != null &&
        (typeof shared.label_prefix !== "string" ||
          shared.label_prefix.trim().length > 40)) ||
      (shared.start_at != null && typeof shared.start_at !== "string") ||
      (shared.end_at != null && typeof shared.end_at !== "string")) return null;
  if (request.mode === "time") {
    const start = jstMinute(request.start_at);
    const end = jstMinute(request.end_at);
    if (start === null || end === null || end <= start ||
        !validInteger(request.interval_minutes, 1, 1440)) return null;
    const count = Math.floor((end - start) / request.interval_minutes);
    if (count < 1 || count > 100) return null;
    return { action: "generateSlotsBatch", eventId, body: {
      mode: "time", start_at: request.start_at, end_at: request.end_at,
      interval_minutes: request.interval_minutes,
    } };
  }
  if (request.mode === "count" &&
      validInteger(request.count, 1, 100) &&
      validInteger(request.start_index, 0, 9999) &&
      typeof request.label_prefix === "string" &&
      request.label_prefix.trim().length <= 40) {
    return { action: "generateSlotsBatch", eventId, body: {
      mode: "count", count: request.count,
      start_index: request.start_index, label_prefix: request.label_prefix.trim(),
    } };
  }
  return null;
}

export function planSlotClearAvailable(eventId: string): SlotWriteIntent | null {
  return validId(eventId) ? { action: "deleteAvailableSlots", eventId, body: {} } : null;
}

/** Map UI operation names to the actual nine MIG-0656 JSON contract keys. */
export function planSlotListAction(
  eventId: string, operation: SlotListOperation,
): SlotWriteIntent | null {
  if (!validId(eventId) || !operation || typeof operation !== "object") return null;
  if ("slotId" in operation) {
    if (!validId(operation.slotId)) return null;
    switch (operation.kind) {
      case "delete":
        return { action: "deleteSlot", eventId, slotId: operation.slotId, body: {} };
      case "release":
        return { action: "releaseSlot", eventId, slotId: operation.slotId, body: {} };
      case "force-release-submitted":
        return { action: "forceReleaseSubmittedSlot", eventId, slotId: operation.slotId, body: {} };
      case "release-submitted-video":
        return { action: "releaseSubmittedVideoKeepReservation",
          eventId, slotId: operation.slotId, body: {} };
      default: return null;
    }
  }
  if (!("slotIds" in operation)) return null;
  const ids = slotIds(operation.slotIds);
  if (!ids) return null;
  switch (operation.kind) {
    case "batch-delete":
      return { action: "batchDeleteAvailableSlots", eventId, body: { slot_ids: ids } };
    case "batch-release":
      return { action: "batchReleaseReservedSlots", eventId, body: { slot_ids: ids } };
    case "batch-label": {
      if (typeof operation.label !== "string") return null;
      const label = operation.label.trim();
      if (!label || label.length > 200) return null;
      return { action: "batchUpdateSlotLabels", eventId,
        body: { slot_ids: ids, label } };
    }
    default: return null;
  }
}
