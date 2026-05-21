export function uniqueBy<T, K extends string | number | symbol>(
  items: readonly T[],
  getKey: (item: T) => K | null | undefined,
): T[] {
  const seen = new Set<K>();
  const out: T[] = [];

  for (const item of items) {
    const key = getKey(item);
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}
