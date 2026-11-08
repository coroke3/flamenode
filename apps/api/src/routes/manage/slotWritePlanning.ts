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
