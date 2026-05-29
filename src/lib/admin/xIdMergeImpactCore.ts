export interface XIdMergeImpactItem {
  key: string;
  label: string;
  count: number;
}

export function totalMergeImpact(items: readonly XIdMergeImpactItem[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, item.count), 0);
}

export function summarizeMergeImpact(
  items: readonly XIdMergeImpactItem[],
): string {
  const changed = items.filter((item) => item.count > 0);
  if (changed.length === 0) return "影響行はありません。";
  return changed.map((item) => `${item.label}: ${item.count}`).join(" / ");
}
