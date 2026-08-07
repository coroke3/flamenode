import { shuffledCopy } from "../utils/shuffle.ts";
import { jstDayKey, needsNostalgicDailyReshuffle } from "./topNostalgicDaily.ts";

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

/** @deprecated Use jstDayKey from topNostalgicDaily.ts */
export function utcDayKey(unixSec: number): string {
  return jstDayKey(unixSec);
}

export { jstDayKey, needsNostalgicDailyReshuffle };
