export type SlotTimeLike = { start_time: number | null };

/** Must match eventForm.slot_interval_minutes maximum (1440 minutes). */
const MAX_SLOT_INTERVAL_SECONDS = 1440 * 60;

export function resolveSlotIntervalSec(args: {
  explicitMinutes?: number | null;
  slots: readonly SlotTimeLike[];
  partGapSec: number;
}): number | null {
  const explicit = Number(args.explicitMinutes);
  // eventForm.slot_interval_minutes is an integer in [1, 1440].
  // Never trust a fractional or out-of-contract legacy value merely because
  // its conversion into seconds happens to round to a positive integer.
  if (Number.isSafeInteger(explicit) && explicit >= 1 && explicit <= 1440) {
    return explicit * 60;
  }

  // The caller converts eventForm.slot_part_gap_minutes (integer 1..1440)
  // into seconds. An invalid legacy setting must not relax the inference cap.
  if (
    !Number.isSafeInteger(args.partGapSec) ||
    args.partGapSec < 60 ||
    args.partGapSec > MAX_SLOT_INTERVAL_SECONDS ||
    args.partGapSec % 60 !== 0
  ) return null;

  const times = args.slots
    .map((slot) => slot.start_time)
    .filter(
      (value): value is number =>
        // Unix slot timestamps must be representable whole seconds; rejecting
        // fractional/unsafe endpoints also prevents an integer-looking gap
        // between two corrupted timestamps from being trusted.
        typeof value === "number" && Number.isSafeInteger(value),
    )
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let index = 1; index < times.length; index++) {
    const gap = times[index]! - times[index - 1]!;
    // Slot timestamps represent whole seconds; fractional gaps can round to
    // a misleading "0秒" recommendation even though they are positive.
    if (Number.isSafeInteger(gap) && gap >= 1 && gap <= args.partGapSec && gap <= MAX_SLOT_INTERVAL_SECONDS) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor((gaps.length - 1) / 2)] ?? null;
}

export function formatDurationJa(seconds: number): string {
  if (!Number.isFinite(seconds)) return "不明";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  if (minutes > 0 && remain > 0) return `${minutes}分${remain}秒`;
  if (minutes > 0) return `${minutes}分`;
  return `${remain}秒`;
}

export function buildConsecutiveSlotGuidance(
  intervalSec: number | null,
): string {
  if (intervalSec == null || !Number.isSafeInteger(intervalSec) || intervalSec < 1 || intervalSec > MAX_SLOT_INTERVAL_SECONDS) {
    return "連続枠は、1作品の尺が長い場合に利用してください。複数作品を投稿する場合は、作品ごとに別の枠を確保してください。";
  }
  const threshold = intervalSec * 0.75;
  return `連続枠は、1作品の尺が長い場合に利用してください。作品尺が${formatDurationJa(threshold)}以上（枠間隔の75%）になる場合は連続枠を推奨します。複数作品を投稿する場合は、作品ごとに別の枠を確保してください。`;
}
