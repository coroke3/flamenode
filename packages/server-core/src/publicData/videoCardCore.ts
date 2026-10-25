import {
  normalizeNumericUnix,
  normalizePresentString,
} from "./normalize.ts";
import { isPublicVideoListable } from "./visibility.ts";

/**
 * Common card display fields across static video JSON rows
 * (top, recommend, user, recent, popular, trending).
 */
export interface StaticVideoCardBase {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  icon_url: string | null;
  primary_event_id: string | null;
  scheduled_time: number | null;
}

/**
 * Normalized card representation matching UI VideoCardData shape
 * without importing frontend React/component dependencies.
 */
export interface StaticVideoCardData {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  icon_url?: string | null;
  creator_x_user_id?: string | null;
  primary_event_id?: string | null;
  scheduled_time?: number | null;
  status?: string | null;
  part?: string | null;
}

/** Non-object rows or rows missing id/title return null. Visibility is evaluated separately. */
export function normalizeStaticVideoCardBase(
  value: unknown,
): StaticVideoCardBase | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizePresentString(row.id);
  const title = normalizePresentString(row.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    youtube_video_id: normalizePresentString(row.youtube_video_id),
    display_name:
      normalizePresentString(row.display_name) ??
      normalizePresentString(row.creator_display_name) ??
      "unknown",
    icon_url:
      normalizePresentString(row.icon_url) ??
      normalizePresentString(row.creator_icon_url),
    primary_event_id: normalizePresentString(row.primary_event_id),
    scheduled_time: normalizeNumericUnix(row.scheduled_time),
  };
}

/** Converts only public/listable rows into StaticVideoCardData. */
export function normalizePublicVideoCard(value: unknown): StaticVideoCardData | null {
  const base = normalizeStaticVideoCardBase(value);
  if (!base) return null;
  const row = value as Record<string, unknown>;
  if (!isPublicVideoListable(row.status ?? row.visibility_status)) return null;
  return {
    ...base,
    creator_x_user_id: normalizePresentString(row.creator_x_user_id),
    status: "public",
    part: normalizePresentString(row.part),
  };
}

export function normalizePublicVideoCardList(value: unknown): StaticVideoCardData[] {
  return Array.isArray(value)
    ? value
        .map(normalizePublicVideoCard)
        .filter((row): row is StaticVideoCardData => row !== null)
    : [];
}
