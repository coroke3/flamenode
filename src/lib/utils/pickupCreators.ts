/** 注目クリエイター候補の作品数集計・並び替え（旧トップ /user 一覧の totalWorks 順を踏襲）。 */

export type PickupCreatorCounts = {
  video_count?: number | null;
  collab_count?: number | null;
  x_name?: string | null;
};

function finiteCount(value: number | null | undefined): number {
  // A D1 COUNT is a non-negative integer. Malformed snapshot/test inputs
  // must not become infinite totals, negative scores or unstable sort keys.
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function counts(row: PickupCreatorCounts): [personal: number, collab: number] {
  return [finiteCount(row.video_count), finiteCount(row.collab_count)];
}

/** 個人作1件以上、または合作のみで2件以上（参考旧 index.jsx / 設計書）。 */
export function isPickupCreatorEligible(row: PickupCreatorCounts): boolean {
  const [personal, collab] = counts(row);
  return personal >= 1 || collab >= 2;
}

function comparePickupCreators(
  a: PickupCreatorCounts,
  b: PickupCreatorCounts,
): number {
  const [aPersonal, aCollab] = counts(a);
  const [bPersonal, bCollab] = counts(b);
  const totalDiff = bPersonal + bCollab - aPersonal - aCollab;
  if (totalDiff !== 0) return totalDiff;
  const personalDiff = bPersonal - aPersonal;
  return personalDiff || (a.x_name ?? "").localeCompare(b.x_name ?? "", "ja");
}

/** 合計作品数 → 個人作品数 → 名前の順で降順優先。 */
export function sortPickupCreators<T extends PickupCreatorCounts>(
  rows: T[],
): T[] {
  return [...rows].sort(comparePickupCreators);
}
