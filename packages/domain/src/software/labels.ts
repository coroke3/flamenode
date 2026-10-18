export const SOFTWARE_LABEL_MAX_ITEMS = 20;
export const SOFTWARE_LABEL_MAX_LENGTH = 80;

export function normalizeSoftwareCatalogName(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeSoftwareKey(value: string | null | undefined): string {
  return normalizeSoftwareCatalogName(value).replace(/\s+/g, "");
}

export function normalizeSoftwareLabels(
  raw: (string | null | undefined)[] | string | null | undefined,
): string[] {
  if (!raw) return [];
  const sourceItems = Array.isArray(raw) ? raw : String(raw).split(/[\n,;、，]+/);
  const items: string[] = [];
  const seen = new Set<string>();
  for (const sourceItem of sourceItems) {
    if (!sourceItem) continue;
    const item = String(sourceItem)
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, SOFTWARE_LABEL_MAX_LENGTH);
    if (!item) continue;
    const key = normalizeSoftwareKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= SOFTWARE_LABEL_MAX_ITEMS) break;
  }
  return items;
}
