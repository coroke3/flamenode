import { pickNostalgicDisplay } from "./topNostalgicShuffle.ts";

const JST_TIME_ZONE = "Asia/Tokyo";

/** JST 日付境界（UTC+9）の YYYY-MM-DD。 */
export function jstDayKey(unixSec: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: JST_TIME_ZONE }).format(
    new Date(unixSec * 1000),
  );
}

export type NostalgicSectionPrevious = {
  displayIds: readonly string[];
  selectionDay: string;
  shuffledAt: number;
};

export type NostalgicDisplaySelection<T> = {
  display: T[];
  shuffledAt: number;
  selectionDay: string;
  isNewDaySelection: boolean;
};

export function resolveNostalgicDisplaySelection<T extends { id: string }>(opts: {
  pool: readonly T[];
  previous: NostalgicSectionPrevious | null;
  now: number;
  limit: number;
  rehydrateById: (ids: readonly string[]) => T[];
}): NostalgicDisplaySelection<T> {
  const selectionDay = jstDayKey(opts.now);
  const poolById = new Map(opts.pool.map((item) => [String(item.id), item]));

  if (opts.previous && opts.previous.selectionDay === selectionDay) {
    const rehydrated = opts.rehydrateById(opts.previous.displayIds);
    const rehydratedById = new Map(rehydrated.map((item) => [String(item.id), item]));
    const display = opts.previous.displayIds
      .map((id) => rehydratedById.get(id) ?? poolById.get(id))
      .filter((item): item is T => item != null);
    return {
      display,
      shuffledAt: opts.previous.shuffledAt,
      selectionDay,
      isNewDaySelection: false,
    };
  }

  const display = pickNostalgicDisplay(opts.pool, opts.limit);
  return {
    display,
    shuffledAt: opts.now,
    selectionDay,
    isNewDaySelection: true,
  };
}

/** R2 上の懐かし表示が別 JST 日になっていれば日次抽選が必要。 */
export function needsNostalgicDailyReshuffle(
  shuffledAt: number | null | undefined,
  now: number,
): boolean {
  if (!shuffledAt || !Number.isFinite(shuffledAt) || shuffledAt <= 0) {
    return true;
  }
  return jstDayKey(shuffledAt) !== jstDayKey(now);
}
