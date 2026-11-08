/**
 * Browser read of RH-020 (`GET /api/live/events/{id}/slots`, CURRENT route kept until Phase 6). Returns null on
 * any failure so callers keep the static body and show a degraded note (MIG-0502 T05).
 */
export type LiveSlotStatus = "available" | "reserved" | "submitted";
export type LiveSlotRow = Readonly<{ id: string; status: LiveSlotStatus; display_name?: string | null; public_video_id?: string | null }>;
export type LiveSlots = Readonly<{ slots: readonly LiveSlotRow[]; truncated: boolean }>;

export function parseLiveSlots(value: unknown): LiveSlots | null {
  if (!value || typeof value !== "object") return null;
  const rows = (value as { slots?: unknown }).slots;
  if (!Array.isArray(rows)) return null;
  const slots: LiveSlotRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    // The UI treats every non-available status as taken; reject unknown values
    // instead of displaying corrupt or changed API data as occupied slots.
    if (typeof r.id !== "string" ||
        (r.status !== "available" && r.status !== "reserved" && r.status !== "submitted")) return null;
    slots.push({
      id: r.id,
      status: r.status,
      display_name: typeof r.display_name === "string" ? r.display_name : null,
      public_video_id: typeof r.public_video_id === "string" ? r.public_video_id : null,
    });
  }
  return { slots, truncated: (value as { truncated?: unknown }).truncated === true };
}

export async function fetchLiveSlots(
  eventId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<LiveSlots | null> {
  try {
    const response = await fetcher(`/api/live/events/${encodeURIComponent(eventId)}/slots`, {
      signal,
      credentials: "omit",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return parseLiveSlots(await response.json());
  } catch {
    return null;
  }
}
