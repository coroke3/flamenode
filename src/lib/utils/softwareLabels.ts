export const SOFTWARE_LABEL_MAX_ITEMS = 20;
export const SOFTWARE_LABEL_MAX_LENGTH = 80;

export type SoftwareLabelsJsonSource = "manual" | "legacy";

export type SoftwareLabelsJson = {
  source: SoftwareLabelsJsonSource;
  raw: string;
  items: string[];
};

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

export function buildSoftwareLabelsJson(
  raw: string | string[] | null | undefined,
  source: SoftwareLabelsJsonSource,
): string | null {
  const items = normalizeSoftwareLabels(raw);
  if (items.length === 0) return null;
  return JSON.stringify({
    source,
    raw: items.join(", "),
    items,
  } satisfies SoftwareLabelsJson);
}

export function buildEmptySoftwareLabelsJson(
  source: SoftwareLabelsJsonSource,
): string {
  return JSON.stringify({
    source,
    raw: "",
    items: [],
  } satisfies SoftwareLabelsJson);
}

export function parseSoftwareLabelsJson(
  json: string | null | undefined,
): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeSoftwareLabels(
        parsed.filter((item): item is string => typeof item === "string"),
      );
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as { items?: unknown; raw?: unknown };
      if (Array.isArray(obj.items)) {
        return normalizeSoftwareLabels(
          obj.items.filter((item): item is string => typeof item === "string"),
        );
      }
      if (typeof obj.raw === "string") return normalizeSoftwareLabels(obj.raw);
    }
  } catch {
    return normalizeSoftwareLabels(json);
  }
  return [];
}
