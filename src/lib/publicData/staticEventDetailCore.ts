import {
  isPublicVideoListable,
  normalizePublicEventVisibility,
} from "./visibility.ts";
import {
  normalizeCount,
  normalizeCoercedString as normalizeNullableString,
  normalizeNullableUnix as normalizeUnix,
  normalizeTrimmedString as normalizeString,
} from "./normalize";

export interface StaticEventDetailPayload {
  generated_at?: unknown;
  freshness?: unknown;
  event?: Record<string, unknown>;
  public_staff?: unknown;
  slots_summary?: unknown;
  slots?: unknown;
  public_videos?: unknown;
  video_total?: unknown;
  creator_count?: unknown;
}

export interface StaticEventDetailVideo {
  id: string;
  title: string;
  creator_x_user_id: string | null;
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
  slot_part_gap_minutes: number | null;
  slot_visibility_mode: "public_name" | "anonymous" | "hidden" | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  visibility_status: "public";
}

export interface StaticEventDetailStaff {
  role: string | null;
  display_name: string;
  public_role_label: string | null;
  x_user_id: string | null;
  x_name: string | null;
  icon_url: string | null;
  has_public_profile: boolean;
}

export interface StaticEventSlotSummary {
  status: string;
  count: number;
}

export interface StaticEventSlot {
  id: string;
  status: "available" | "reserved" | "submitted";
  start_time: number | null;
  sort_order: number | null;
}

export interface StaticEventDetail {
  generatedAt: number | null;
  event: StaticEventDetailEvent;
  publicStaff: StaticEventDetailStaff[];
  slotSummary: StaticEventSlotSummary[];
  slots: StaticEventSlot[];
  publicVideos: StaticEventDetailVideo[];
  videoTotal: number;
  creatorCount: number;
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
  const slots = Array.isArray(payload.slots)
    ? payload.slots
        .map(normalizeEventSlot)
        .filter((row): row is StaticEventSlot => row !== null)
    : [];

  return {
    generatedAt: normalizeUnix(payload.generated_at),
    event,
    publicStaff,
    slotSummary,
    slots,
    publicVideos: videos,
    videoTotal: normalizeCount(payload.video_total) ?? videos.length,
    creatorCount: normalizeCount(payload.creator_count) ?? 0,
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
    slot_part_gap_minutes: normalizeCount(row.slot_part_gap_minutes),
    slot_visibility_mode: normalizeSlotVisibilityMode(row.slot_visibility_mode),
    start_time: normalizeUnix(row.start_time),
    end_time: normalizeUnix(row.end_time),
    entry_start_time: normalizeUnix(row.entry_start_time),
    entry_end_time: normalizeUnix(row.entry_end_time),
    visibility_status: visibility,
  };
}

function normalizeSlotVisibilityMode(
  value: unknown,
): StaticEventDetailEvent["slot_visibility_mode"] {
  const mode = normalizeNullableString(value);
  if (mode === "public_name" || mode === "anonymous" || mode === "hidden") {
    return mode;
  }
  return null;
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
    creator_x_user_id: normalizeNullableString(row.creator_x_user_id),
    youtube_video_id: normalizeNullableString(row.youtube_video_id),
    creator_display_name:
      normalizeString(row.creator_display_name) ??
      normalizeString(row.display_name) ??
      "unknown",
    creator_icon_url:
      normalizeNullableString(row.creator_icon_url) ??
      normalizeNullableString(row.icon_url),
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
    has_public_profile:
      row.has_public_profile === 1 || row.has_public_profile === true,
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

function normalizeEventSlot(value: unknown): StaticEventSlot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const status = normalizeString(row.status);
  if (!id || (status !== "available" && status !== "reserved" && status !== "submitted")) {
    return null;
  }
  return {
    id,
    status,
    start_time: normalizeUnix(row.start_time),
    sort_order: normalizeCount(row.sort_order),
  };
}
