export interface StaticVideoDetailPayload {
  generated_at?: unknown;
  video?: Record<string, unknown>;
  event_ids?: unknown;
  public_members?: unknown;
}

export interface StaticVideoDetailVideo {
  id: string;
  title: string;
  youtube_video_id: string | null;
  creator_display_name: string | null;
  creator_x_user_id: string | null;
  creator_icon_url: string | null;
  music: string | null;
  credit: string | null;
  intro_comment: string | null;
  highlights: string | null;
  production_story: string | null;
  closing_comment: string | null;
  visibility_status: string;
  scheduled_time: number | null;
  primary_event_id: string | null;
  collaboration_type: string | null;
  part: string | null;
}

export interface StaticVideoMember {
  display_name: string;
  x_user_id: string | null;
  role_label: string | null;
  order_index: number | null;
}

export interface StaticVideoDetail {
  generatedAt: number | null;
  video: StaticVideoDetailVideo;
  eventIds: string[];
  publicMembers: StaticVideoMember[];
}

export function normalizeStaticVideoDetail(
  payload: StaticVideoDetailPayload,
): StaticVideoDetail | null {
  if (!payload.video || typeof payload.video !== "object") return null;
  const video = normalizeVideo(payload.video);
  if (!video) return null;

  const eventIds = Array.isArray(payload.event_ids)
    ? payload.event_ids
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];
  const publicMembers = Array.isArray(payload.public_members)
    ? payload.public_members
        .map(normalizeMember)
        .filter((member): member is StaticVideoMember => member !== null)
    : [];

  return {
    generatedAt: normalizeUnix(payload.generated_at),
    video,
    eventIds,
    publicMembers,
  };
}

function normalizeVideo(value: unknown): StaticVideoDetailVideo | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    youtube_video_id: normalizeNullableString(row.youtube_video_id),
    creator_display_name: normalizeNullableString(row.creator_display_name),
    creator_x_user_id: normalizeNullableString(row.creator_x_user_id),
    creator_icon_url: normalizeNullableString(row.creator_icon_url),
    music: normalizeNullableString(row.music),
    credit: normalizeNullableString(row.credit),
    intro_comment: normalizeNullableString(row.intro_comment),
    highlights: normalizeNullableString(row.highlights),
    production_story: normalizeNullableString(row.production_story),
    closing_comment: normalizeNullableString(row.closing_comment),
    visibility_status: normalizeString(row.visibility_status) ?? "public",
    scheduled_time: normalizeUnix(row.scheduled_time),
    primary_event_id: normalizeNullableString(row.primary_event_id),
    collaboration_type: normalizeNullableString(row.collaboration_type),
    part: normalizeNullableString(row.part),
  };
}

function normalizeMember(value: unknown): StaticVideoMember | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const displayName = normalizeString(row.display_name);
  if (!displayName) return null;
  return {
    display_name: displayName,
    x_user_id: normalizeNullableString(row.x_user_id),
    role_label: normalizeNullableString(row.role_label),
    order_index: normalizeUnix(row.order_index),
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
