/**
 * MIG-0656 U03d — complete CURRENT videos before-image for strict audit.
 * Schema source: packages/db/src/schema/canonical.ts (videos, 30 columns).
 * Read inside SA-056/057's THIRD existing D1 SELECT, no additional I/O.
 * Reject absent, shortened and wrongly typed snapshots before any D1 batch.
 */
import type { videos } from "@flamenode/db";

export type SubmittedVideoAuditBefore = typeof videos.$inferSelect;

export const SUBMITTED_VIDEO_AUDIT_COLUMNS = [
  "id", "primary_event_id", "creator_x_user_id",
  "submitted_by_user_id", "collaboration_type", "part", "source_type",
  "creator_display_name", "creator_display_name_yomi", "creator_icon_url",
  "creator_youtube_channel_url", "creator_profile_text",
  "creator_other_social_links", "title", "music", "credit",
  "music_reference_url", "closing_comment", "youtube_video_id",
  "intro_comment", "highlights", "production_story",
  "visibility_status", "scheduling_type", "scheduled_time",
  "app_like_count", "score", "score_updated_at", "created_at", "updated_at",
] as const;

const REQUIRED_TEXT = new Set<string>([
  "id", "submitted_by_user_id", "collaboration_type",
  "source_type", "creator_display_name", "title", "visibility_status",
]);
const OPTIONAL_TEXT = new Set<string>([
  "primary_event_id", "creator_x_user_id", "part",
  "creator_display_name_yomi", "creator_icon_url",
  "creator_youtube_channel_url", "creator_profile_text",
  "creator_other_social_links", "music", "credit",
  "music_reference_url", "closing_comment", "youtube_video_id",
  "intro_comment", "highlights", "production_story", "scheduling_type",
]);
const REQUIRED_INTEGER = new Set<string>([
  "app_like_count", "created_at", "updated_at",
]);
const OPTIONAL_INTEGER = new Set<string>(["scheduled_time", "score_updated_at"]);

export const SUBMITTED_VIDEO_AUDIT_JSON_FIELDS = SUBMITTED_VIDEO_AUDIT_COLUMNS
  .map((key) => "'" + key + "', v.\"" + key + "\"").join(", ");

/** Full 30-key shape, compatible with Drizzle's videos.$inferSelect. */
export function parseSubmittedVideoAuditBefore(
  raw: unknown,
): SubmittedVideoAuditBefore | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const known = new Set<string>(SUBMITTED_VIDEO_AUDIT_COLUMNS);
  if (Object.keys(row).length !== SUBMITTED_VIDEO_AUDIT_COLUMNS.length ||
      Object.keys(row).some((key) => !known.has(key))) return null;
  for (const name of SUBMITTED_VIDEO_AUDIT_COLUMNS) {
    const value = row[name];
    if (REQUIRED_TEXT.has(name)) {
      if (typeof value !== "string") return null;
    } else if (OPTIONAL_TEXT.has(name)) {
      if (value !== null && typeof value !== "string") return null;
    } else if (REQUIRED_INTEGER.has(name)) {
      if (!Number.isSafeInteger(value)) return null;
    } else if (OPTIONAL_INTEGER.has(name)) {
      if (value !== null && !Number.isSafeInteger(value)) return null;
    } else if (name === "score") {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
    } else {
      return null;
    }
  }
  return row as SubmittedVideoAuditBefore;
}
