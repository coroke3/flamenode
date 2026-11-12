/**
 * MIG-0656 U02a: pure SA-058 generated-slot candidate preparation.
 * No IDs, D1 transactions, permission decisions, notifications, or API mounts.
 * Hono U02b must still perform authorized, audited CAS/uniqueness writes.
 */
import { SlotGenerateBodySchema } from "@flamenode/contracts";
import { parseJstDatetimeLocalStrict } from "@flamenode/domain/datetime";

export type GeneratedSlotCandidate = {
  start_time: number | null;
  sort_order: number;
  slot_label: string | null;
};

export type GeneratedSlotPlan =
  | { ok: true; candidates: GeneratedSlotCandidate[] }
  | { ok: false; message: string };

/**
 * MIG-0656 U02b-0: prepare the exact CURRENT SA-058 row defaults in memory.
 * Future handlers must authorize event.slots and perform conflict/CAS checks,
 * atomic D1 writes, strict audit and Queue handling independently.
 * This function has no I/O, authorizes nobody, and is not mounted as a route.
 */
export type GeneratedSlotInsertRow = GeneratedSlotCandidate & {
  id: string;
  event_id: string;
  reserved_by_user_id: null;
  x_user_id: null;
  reserved_x_id_snapshot: null;
  display_name: null;
  reservation_group_id: null;
  video_id: null;
  status: "available";
  updated_at: number;
  version: 1;
};

export function materializeGeneratedSlotRows(
  eventId: string,
  candidates: readonly GeneratedSlotCandidate[],
  updatedAt: number,
  nextId: () => string,
): GeneratedSlotInsertRow[] {
  // Reject malformed internal callers before any future D1 work is attempted.
  const canonicalEventId = eventId.trim();
  if (!canonicalEventId || !Number.isSafeInteger(updatedAt) ||
      candidates.length < 1 || candidates.length > 100) {
    throw new Error("Invalid generated slot row inputs");
  }
  const ids = new Set<string>();
  return candidates.map((candidate) => {
    if (!Number.isSafeInteger(candidate.sort_order) || candidate.sort_order < 0 ||
        (candidate.start_time !== null && !Number.isSafeInteger(candidate.start_time)) ||
        (candidate.slot_label !== null && typeof candidate.slot_label !== "string")) {
      throw new Error("Invalid generated slot candidate");
    }
    const id = nextId();
    if (typeof id !== "string" || !id.trim() || id !== id.trim() || ids.has(id)) {
      throw new Error("Invalid or duplicate generated slot ID");
    }
    ids.add(id);
    return {
      id,
      event_id: canonicalEventId,
      reserved_by_user_id: null,
      x_user_id: null,
      reserved_x_id_snapshot: null,
      display_name: null,
      slot_label: candidate.slot_label,
      start_time: candidate.start_time,
      sort_order: candidate.sort_order,
      reservation_group_id: null,
      video_id: null,
      status: "available",
      updated_at: updatedAt,
      version: 1,
    };
  });
}

const MAX_GENERATED_SLOTS = 100;

/**
 * Preserve CURRENT generateSlotsBatch semantics:
 * - strict JST parsing (including :ss), no Date.parse rollover
 * - floor((end-start)/interval); only complete intervals produce rows
 * - 0 is a valid Unix start, and time-mode sort_order starts at zero
 * - count-mode zero start_index becomes 1, empty prefix becomes "No."
 * - reject zero or >100 generated rows before any write
 */
export function planGeneratedSlots(input: unknown): GeneratedSlotPlan {
  const parsed = SlotGenerateBodySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "入力エラー" };
  const data = parsed.data;
  if (data.mode === "time") {
    const start = parseJstDatetimeLocalStrict(data.start_at);
    const end = parseJstDatetimeLocalStrict(data.end_at);
    if (!start.ok || !end.ok || start.value === null || end.value === null ||
        end.value <= start.value) {
      return { ok: false, message: "開始・終了日時を正しく指定してください。" };
    }
    const intervalSeconds = data.interval_minutes * 60;
    const count = Math.floor((end.value - start.value) / intervalSeconds);
    if (count === 0) return { ok: false, message: "作成対象の枠がありません。" };
    if (count > MAX_GENERATED_SLOTS) {
      return { ok: false, message: `一度に作成できる枠は ${MAX_GENERATED_SLOTS} 件までです。` };
    }
    const candidates: GeneratedSlotCandidate[] = [];
    for (let i = 0; i < count; i += 1) {
      candidates.push({
        start_time: start.value + i * intervalSeconds,
        sort_order: i,
        slot_label: null,
      });
    }
    return { ok: true, candidates };
  }

  const prefix = data.label_prefix?.trim() || "No.";
  const startIndex = Math.max(1, data.start_index || 1);
  const candidates: GeneratedSlotCandidate[] = [];
  for (let i = 0; i < data.count; i += 1) {
    const order = startIndex + i;
    candidates.push({ start_time: null, sort_order: order, slot_label: `${prefix}${order}` });
  }
  return { ok: true, candidates };
}
