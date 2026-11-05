export type SlotTimeLike = { start_time: number | null };

/** Must match eventForm.slot_interval_minutes maximum (1440 minutes). */
const MAX_SLOT_INTERVAL_SECONDS = 1440 * 60;

export function resolveSlotIntervalSec(args: {
  explicitMinutes?: number | null;
  slots: readonly SlotTimeLike[];
  partGapSec: number;
}): number | null {
  const explicit = Number(args.explicitMinutes);
  const explicitSeconds = Math.round(explicit * 60);
  if (
    Number.isFinite(explicit) && explicit > 0 &&
    Number.isSafeInteger(explicitSeconds) &&
    explicitSeconds >= 1 && explicitSeconds <= MAX_SLOT_INTERVAL_SECONDS
  ) {
    return explicitSeconds;
  }

  const times = args.slots
    .map((slot) => slot.start_time)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
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
