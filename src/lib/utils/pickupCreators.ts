/** 注目クリエイター候補の作品数集計・並び替え（旧トップ /user 一覧の totalWorks 順を踏襲）。 */

export type PickupCreatorCounts = {
  video_count?: number | null;
  collab_count?: number | null;
  x_name?: string | null;
};

export function pickupCreatorPersonalCount(row: PickupCreatorCounts): number {
  return Number(row.video_count) || 0;
}

export function pickupCreatorCollabCount(row: PickupCreatorCounts): number {
  return Number(row.collab_count) || 0;
}

export function pickupCreatorTotalWorks(row: PickupCreatorCounts): number {
  return pickupCreatorPersonalCount(row) + pickupCreatorCollabCount(row);
}

/** 個人作1件以上、または合作のみで2件以上（参考旧 index.jsx / 設計書）。 */
export function isPickupCreatorEligible(row: PickupCreatorCounts): boolean {
  const personal = pickupCreatorPersonalCount(row);
  const collab = pickupCreatorCollabCount(row);
  return personal >= 1 || collab >= 2;
}

/** 合計作品数 → 個人作品数 → 名前の順で降順優先。 */
export function comparePickupCreators(
  a: PickupCreatorCounts,
  b: PickupCreatorCounts,
): number {
  const totalDiff = pickupCreatorTotalWorks(b) - pickupCreatorTotalWorks(a);
  if (totalDiff !== 0) return totalDiff;

  const personalDiff =
    pickupCreatorPersonalCount(b) - pickupCreatorPersonalCount(a);
  if (personalDiff !== 0) return personalDiff;

  return (a.x_name ?? "").localeCompare(b.x_name ?? "", "ja");
}

export function sortPickupCreators<T extends PickupCreatorCounts>(
  rows: T[],
): T[] {
  return [...rows].sort(comparePickupCreators);
}
