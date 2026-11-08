import type { ParsedMemberChapter } from "@/lib/video/memberInputs";

export interface StoredMemberChapter {
  time_seconds: number;
  label: string;
  note: string;
  order_index: number;
}

export function serializeMemberChaptersJson(
  chapters: readonly ParsedMemberChapter[],
): string | null {
  if (chapters.length === 0) return null;
  const payload: StoredMemberChapter[] = chapters.map((ch) => ({
    time_seconds: ch.time_seconds,
    label: ch.label,
    note: ch.note,
    order_index: ch.order_index,
  }));
  return JSON.stringify(payload);
}

export function parseMemberChaptersJson(
  raw: string | null | undefined,
): StoredMemberChapter[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: StoredMemberChapter[] = [];
    for (const [index, item] of parsed.entries()) {
      if (typeof item !== "object" || item === null) continue;
      const o = item as Record<string, unknown>;
      const rawTime = o.time_seconds ?? o.time ?? o.chapter_time;
      // Accept legacy numeric strings, but never treat empty or boolean values as a chapter at 0s.
      if (typeof rawTime !== "number" && typeof rawTime !== "string") continue;
      if (typeof rawTime === "string" && !rawTime.trim()) continue;
      const timeSeconds = Number(rawTime);
      if (!Number.isSafeInteger(timeSeconds) || timeSeconds < 0) continue;
      const label = String(o.label ?? o.chapter_label ?? "").trim();
      if (!label) continue;
      const rawOrder = o.order_index ?? o.sort_order ?? index;
      const parsedOrder = Number(rawOrder);
      const orderIndex = Number.isSafeInteger(parsedOrder) && parsedOrder >= 0
        ? parsedOrder
        : index;
      out.push({
        time_seconds: timeSeconds,
        label,
        note: String(o.note ?? "").trim(),
        order_index: orderIndex,
      });
    }
    return out.sort((a, b) => a.order_index - b.order_index);
  } catch {
    return [];
  }
}
