import { isPublicVideoListable, normalizePublicEventVisibility } from "./visibility.ts";
import {
  normalizeCoercedString,
  normalizeCount,
  normalizeNullableUnix,
  normalizeTrimmedString,
} from "./normalize.ts";
import { EVENT_RELEASE_SCHEMA_VERSION, eventReleaseObjectKey } from "./staticEventDetailCore.ts";

export { EVENT_RELEASE_SCHEMA_VERSION, eventReleaseObjectKey };

export const EVENT_RELEASE_MAX_VIDEOS = 500;
export const EVENT_RELEASE_MAX_MEMBERS_PER_VIDEO = 100;

export type StaticEventReleaseMember = {
  name: string;
  x_user_id: string | null;
  role: string | null;
  comment: string | null;
  order_index: number;
};

export type StaticEventReleaseVideo = {
  id: string;
  title: string;
  youtube_video_id: string | null;
  scheduled_time: number | null;
  collaboration_type: "individual" | "collab";
  part: string | null;
  intro_comment: string | null;
  creator_display_name: string;
  creator_x_user_id: string | null;
  creator_icon_url: string | null;
  visibility_status: "public";
  members: StaticEventReleaseMember[];
};

export type StaticEventRelease = {
  schemaVersion: 1;
  generatedAt: number | null;
  event: {
    id: string;
    title: string;
    accent_color: string | null;
    visibility_status: "public";
  };
  videos: StaticEventReleaseVideo[];
  total: number;
  truncated: boolean;
};

export type StaticEventReleasePayload = {
  schema_version?: unknown;
  generated_at?: unknown;
  event?: unknown;
  videos?: unknown;
  total?: unknown;
  truncated?: unknown;
};

export function normalizeStaticEventRelease(
  payload: StaticEventReleasePayload,
): StaticEventRelease | null {
  if (payload.schema_version !== EVENT_RELEASE_SCHEMA_VERSION) return null;
  if (!payload.event || typeof payload.event !== "object") return null;
  const eventRow = payload.event as Record<string, unknown>;
  const eventId = normalizeTrimmedString(eventRow.id);
  const title = normalizeTrimmedString(eventRow.title);
  const visibility = normalizePublicEventVisibility(eventRow.visibility_status);
  if (!eventId || !title || visibility !== "public") return null;

  const rawVideos = Array.isArray(payload.videos) ? payload.videos : [];
  const normalizedVideos = rawVideos.map(normalizeReleaseVideo);
  const hadInvalidVideoRows = normalizedVideos.some((video) => video === null);
  const videos = normalizedVideos
    .filter((video): video is StaticEventReleaseVideo => video !== null)
    .slice(0, EVENT_RELEASE_MAX_VIDEOS);
  // A stale artifact may still carry a count for rows that are no longer
  // public. Do not expose that count at the public boundary; the generator
  // can still advertise a larger total through a valid, truncated artifact.
  const total = hadInvalidVideoRows
    ? videos.length
    : Math.max(
        videos.length,
        Math.min(EVENT_RELEASE_MAX_VIDEOS, normalizeCount(payload.total) ?? videos.length),
      );
  return {
    schemaVersion: EVENT_RELEASE_SCHEMA_VERSION,
    generatedAt: normalizeNullableUnix(payload.generated_at),
    event: {
      id: eventId,
      title,
      accent_color: normalizeCoercedString(eventRow.accent_color),
      visibility_status: "public",
    },
    videos,
    total,
    truncated: payload.truncated === true || total > videos.length,
  };
}

function normalizeReleaseVideo(value: unknown): StaticEventReleaseVideo | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeTrimmedString(row.id);
  const title = normalizeTrimmedString(row.title);
  if (!id || !title || !isPublicVideoListable(row.visibility_status)) return null;
  const rawMembers = Array.isArray(row.members) ? row.members : [];
  const members = rawMembers
    .map(normalizeReleaseMember)
    .filter((member): member is StaticEventReleaseMember => member !== null)
    .sort((a, b) => a.order_index - b.order_index || a.name.localeCompare(b.name))
    .slice(0, EVENT_RELEASE_MAX_MEMBERS_PER_VIDEO);
  const collaborationType = row.collaboration_type === "collab" ? "collab" : "individual";
  return {
    id,
    title,
    youtube_video_id: normalizeCoercedString(row.youtube_video_id),
    scheduled_time: normalizeNullableUnix(row.scheduled_time),
    collaboration_type: collaborationType,
    part: normalizeCoercedString(row.part),
    intro_comment: normalizeCoercedString(row.intro_comment),
    creator_display_name: normalizeTrimmedString(row.creator_display_name) ?? "unknown",
    creator_x_user_id: normalizeCoercedString(row.creator_x_user_id),
    creator_icon_url: normalizeCoercedString(row.creator_icon_url),
    visibility_status: "public",
    members,
  };
}

function normalizeReleaseMember(value: unknown): StaticEventReleaseMember | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  // Generated release artifacts only contain public members. Re-check the
  // marker when reading stale or manually edited R2 JSON as a second fence.
  if (
    row.is_public_member != null &&
    row.is_public_member !== 1 &&
    row.is_public_member !== true
  ) {
    return null;
  }
  const name = normalizeTrimmedString(row.name);
  if (!name) return null;
  return {
    name,
    x_user_id: normalizeCoercedString(row.x_user_id),
    role: normalizeCoercedString(row.role),
    comment: normalizeCoercedString(row.comment),
    order_index: normalizeCount(row.order_index) ?? 0,
  };
}
