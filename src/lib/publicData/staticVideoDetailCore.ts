export interface StaticVideoDetailPayload {
  generated_at?: unknown;
  video?: Record<string, unknown>;
  event_ids?: unknown;
  public_members?: unknown;
}

export interface StaticVideoDetail {
  generatedAt: number | null;
  video: Record<string, unknown>;
  eventIds: string[];
}

export function normalizeStaticVideoDetail(
  payload: StaticVideoDetailPayload,
): StaticVideoDetail | null {
  if (!payload.video || typeof payload.video !== "object") return null;
  const video = payload.video;
  const id = normalizeString(video.id);
  if (!id) return null;

  const eventIds = Array.isArray(payload.event_ids)
    ? payload.event_ids
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];

  return {
    generatedAt: normalizeUnix(payload.generated_at),
    video,
    eventIds,
  };
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeUnix(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : null;
}
