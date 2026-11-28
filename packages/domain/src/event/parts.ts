/** Event-part normalization shared by CURRENT and the Hono event lifecycle adapter. */
const PART_NAME_MAX_LEN = 40;
const PART_MAX_COUNT = 20;

export function buildPartsJson(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const truncated = trimmed.slice(0, PART_NAME_MAX_LEN);
    if (seen.has(truncated)) continue;
    seen.add(truncated);
    parts.push(truncated);
    if (parts.length >= PART_MAX_COUNT) break;
  }
  return parts.length === 0 ? null : JSON.stringify(parts);
}
