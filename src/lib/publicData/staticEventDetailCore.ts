export interface StaticEventDetailPayload {
  generated_at?: unknown;
  freshness?: unknown;
  event?: Record<string, unknown>;
  public_staff?: unknown;
  slots_summary?: unknown;
  public_videos?: unknown;
}

export interface StaticEventDetailVideo {
  id: string;
  title: string;
  youtube_video_id: string | null;
  creator_display_name: string;
  creator_x_user_id: string | null;
  creator_icon_url: string | null;
  visibility_status: string;
  scheduled_time: number | null;
}

export interface StaticEventDetail {
  generatedAt: number | null;
  event: Record<string, unknown>;
  publicVideos: StaticEventDetailVideo[];
}

export function normalizeStaticEventDetail(
  payload: StaticEventDetailPayload,
): StaticEventDetail | null {
  if (!payload.event || typeof payload.event !== "object") return null;
  const event = payload.event;
  const id = normalizeString(event.id);
  if (!id) return null;

  const videos = Array.isArray(payload.public_videos)
    ? payload.public_videos
        .map(normalizeEventVideo)
        .filter((row): row is StaticEventDetailVideo => row !== null)
    : [];

  return {
    generatedAt: normalizeUnix(payload.generated_at),
    event,
    publicVideos: videos,
  };
}

function normalizeEventVideo(value: unknown): StaticEventDetailVideo | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    youtube_video_id: normalizeNullableString(row.youtube_video_id),
    creator_display_name:
      normalizeString(row.creator_display_name) ?? "unknown",
    creator_x_user_id: normalizeNullableString(row.creator_x_user_id),
    creator_icon_url: normalizeNullableString(row.creator_icon_url),
    visibility_status: normalizeString(row.visibility_status) ?? "public",
    scheduled_time: normalizeUnix(row.scheduled_time),
  };
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return String(value);
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeUnix(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : null;
}
