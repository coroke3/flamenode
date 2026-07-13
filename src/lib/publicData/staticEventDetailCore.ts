import {
  isPublicVideoListable,
  normalizePublicEventVisibility,
} from "./visibility.ts";

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
  /** UI compatibility only; public payloads must not populate this internal key. */
  creator_x_user_id?: string;
  youtube_video_id: string | null;
  creator_display_name: string;
  creator_icon_url: string | null;
  visibility_status: "public";
  scheduled_time: number | null;
}

export interface StaticEventDetailEvent {
  id: string;
  title: string;
  explanation: string | null;
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  visibility_status: "public" | "archived";
}

export interface StaticEventDetailStaff {
  role: string | null;
  display_name: string;
  public_role_label: string | null;
  x_user_id: string | null;
  x_name: string | null;
  icon_url: string | null;
}

export interface StaticEventSlotSummary {
  status: string;
  count: number;
}

export interface StaticEventDetail {
  generatedAt: number | null;
  event: StaticEventDetailEvent;
  publicStaff: StaticEventDetailStaff[];
  slotSummary: StaticEventSlotSummary[];
  publicVideos: StaticEventDetailVideo[];
}

export function normalizeStaticEventDetail(
  payload: StaticEventDetailPayload,
): StaticEventDetail | null {
  if (!payload.event || typeof payload.event !== "object") return null;
  const event = normalizeEvent(payload.event);
  const id = event?.id;
  if (!id) return null;

  const videos = Array.isArray(payload.public_videos)
    ? payload.public_videos
        .map(normalizeEventVideo)
        .filter((row): row is StaticEventDetailVideo => row !== null)
    : [];
  const publicStaff = Array.isArray(payload.public_staff)
    ? payload.public_staff
        .map(normalizePublicStaff)
        .filter((row): row is StaticEventDetailStaff => row !== null)
    : [];
  const slotSummary = Array.isArray(payload.slots_summary)
    ? payload.slots_summary
        .map(normalizeSlotSummary)
        .filter((row): row is StaticEventSlotSummary => row !== null)
    : [];

  return {
    generatedAt: normalizeUnix(payload.generated_at),
    event,
    publicStaff,
    slotSummary,
    publicVideos: videos,
  };
}

function normalizeEvent(value: unknown): StaticEventDetailEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  const visibility = normalizePublicEventVisibility(row.visibility_status);
  if (!id || !title || !visibility) return null;
  return {
    id,
    title,
    explanation: normalizeNullableString(row.explanation),
    icon_url: normalizeNullableString(row.icon_url),
    img_url: normalizeNullableString(row.img_url),
    accent_color: normalizeNullableString(row.accent_color),
    start_time: normalizeUnix(row.start_time),
    end_time: normalizeUnix(row.end_time),
    entry_start_time: normalizeUnix(row.entry_start_time),
    entry_end_time: normalizeUnix(row.entry_end_time),
    visibility_status: visibility,
  };
}

function normalizeEventVideo(value: unknown): StaticEventDetailVideo | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  if (!id || !title || !isPublicVideoListable(row.visibility_status)) return null;
  return {
    id,
    title,
    youtube_video_id: normalizeNullableString(row.youtube_video_id),
    creator_display_name:
      normalizeString(row.creator_display_name) ?? "unknown",
    creator_icon_url: normalizeNullableString(row.creator_icon_url),
    visibility_status: "public",
    scheduled_time: normalizeUnix(row.scheduled_time),
  };
}

function normalizePublicStaff(value: unknown): StaticEventDetailStaff | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const displayName =
    normalizeString(row.display_name) ??
    normalizeString(row.x_name) ??
    normalizeString(row.x_user_id);
  if (!displayName) return null;
  return {
    role: normalizeNullableString(row.role),
    display_name: displayName,
    public_role_label: normalizeNullableString(row.public_role_label),
    x_user_id: normalizeNullableString(row.x_user_id),
    x_name: normalizeNullableString(row.x_name),
    icon_url: normalizeNullableString(row.icon_url),
  };
}

function normalizeSlotSummary(value: unknown): StaticEventSlotSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const status = normalizeString(row.status);
  const count = normalizeUnix(row.c);
  if (!status || count == null || count < 0) return null;
  return { status, count };
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
