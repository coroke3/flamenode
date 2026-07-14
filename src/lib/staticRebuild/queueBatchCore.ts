import type { StaticRebuildPriority } from "./types";

const PRIORITY_RANK: Record<StaticRebuildPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export function pickHigherPriority(
  a: StaticRebuildPriority,
  b: StaticRebuildPriority,
): StaticRebuildPriority {
  return PRIORITY_RANK[a] <= PRIORITY_RANK[b] ? a : b;
}

export type StaticRebuildTargetRow = {
  target_type: string;
  target_id: string;
};

export function staticRebuildTargetKey(
  targetType: string,
  targetId: string,
): string {
  return `${targetType}:${targetId}`;
}

/** bounded read結果を検証し、同一targetの破損・同時刻tieをfail-closedにする。 */
export function indexUniqueStaticRebuildTargetRows<
  T extends StaticRebuildTargetRow,
>(
  rows: readonly T[],
  options: { maxRows: number; label: "active" | "latest" },
): Map<string, T> {
  if (rows.length > options.maxRows) {
    throw new Error(`static_rebuild_${options.label}_rows_exceeded`);
  }
  const indexed = new Map<string, T>();
  for (const row of rows) {
    const key = staticRebuildTargetKey(row.target_type, row.target_id);
    if (indexed.has(key)) {
      throw new Error(`static_rebuild_${options.label}_target_ambiguous`);
    }
    indexed.set(key, row);
  }
  return indexed;
}
