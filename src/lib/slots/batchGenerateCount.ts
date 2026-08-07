import { MAX_SLOT_BATCH_GENERATE_COUNT } from "./atomicLimits";

export type SlotBatchCountResult =
  | { ok: true; count: number }
  | { ok: false; message: string };

function overLimitMessage(): string {
  return `一度に作成できる枠は ${MAX_SLOT_BATCH_GENERATE_COUNT} 件までです。`;
}

function invalidRangeMessage(): string {
  return "開始・終了日時を正しく指定してください。";
}

/** time モード: start/end/interval から生成件数を事前計算する（行配列は作らない）。 */
export function computeTimeModeSlotBatchCount(
  startSec: number | null,
  endSec: number | null,
  intervalMinutes: number,
): SlotBatchCountResult {
  if (startSec == null || endSec == null || endSec <= startSec) {
    return { ok: false, message: invalidRangeMessage() };
  }
  if (
    !Number.isFinite(intervalMinutes) ||
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 1
  ) {
    return { ok: false, message: "間隔が不正です。" };
  }
  const intervalSec = intervalMinutes * 60;
  if (!Number.isSafeInteger(intervalSec) || intervalSec < 1) {
    return { ok: false, message: "間隔が不正です。" };
  }
  if (!Number.isSafeInteger(startSec) || !Number.isSafeInteger(endSec)) {
    return { ok: false, message: invalidRangeMessage() };
  }

  let count = 0;
  for (
    let cursor = startSec;
    cursor + intervalSec <= endSec;
    cursor += intervalSec
  ) {
    count += 1;
    if (count > MAX_SLOT_BATCH_GENERATE_COUNT) {
      return { ok: false, message: overLimitMessage() };
    }
    if (!Number.isSafeInteger(cursor + intervalSec)) {
      return { ok: false, message: invalidRangeMessage() };
    }
  }
  if (count < 1) {
    return { ok: false, message: "作成対象の枠がありません。" };
  }
  return { ok: true, count };
}

/** count モード: 件数のみ上限検証する。 */
export function computeCountModeSlotBatchCount(
  count: number,
): SlotBatchCountResult {
  if (!Number.isFinite(count) || !Number.isInteger(count) || count < 1) {
    return { ok: false, message: "件数を正しく指定してください。" };
  }
  if (count > MAX_SLOT_BATCH_GENERATE_COUNT) {
    return { ok: false, message: overLimitMessage() };
  }
  return { ok: true, count };
}
