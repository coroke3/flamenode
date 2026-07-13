export const SOFTWARE_LABEL_MAX_ITEMS = 20;
export const SOFTWARE_LABEL_MAX_LENGTH = 80;

export function normalizeSoftwareLabels(
  raw: string | string[] | null | undefined,
): string[] {
  if (!raw) return [];
  const sourceItems = Array.isArray(raw) ? raw : raw.split(/[\n,;、，]+/);
  const items: string[] = [];
  const seen = new Set<string>();
  for (const sourceItem of sourceItems) {
    const item = sourceItem
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, SOFTWARE_LABEL_MAX_LENGTH);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= SOFTWARE_LABEL_MAX_ITEMS) break;
  }
  return items;
}
