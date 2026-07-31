import { shuffledCopy } from "../utils/shuffle.ts";

export const TOP_NOSTALGIC_DISPLAY_LIMIT = 20;

/** 懐かし棚の表示用にプールからランダム抽出する。 */
export function pickNostalgicDisplay<T>(
  pool: readonly T[],
  limit = TOP_NOSTALGIC_DISPLAY_LIMIT,
): T[] {
  if (pool.length <= limit) {
    return shuffledCopy(pool);
  }
  return shuffledCopy(pool).slice(0, limit);
}

export function utcDayKey(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

/** R2 上の懐かし表示が別 UTC 日になっていれば日次シャッフルが必要。 */
export function needsNostalgicDailyReshuffle(
  shuffledAt: number | null | undefined,
  now: number,
): boolean {
  if (!shuffledAt || !Number.isFinite(shuffledAt) || shuffledAt <= 0) {
    return true;
  }
  return utcDayKey(shuffledAt) !== utcDayKey(now);
}
