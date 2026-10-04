import type { VideoCardData } from "@/components/video/VideoCard";
import {
  normalizeNumericUnix,
  normalizePresentString,
} from "./normalize.ts";
import { isPublicVideoListable } from "./visibility.ts";

/**
 * 静的 JSON の動画行（top・recommend・user・recent・popular・trending）が
 * 共有するカード表示部分。表示名とアイコンは動画行の値を優先し、無ければ
 * creator_* 列で補う。
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

/** object でない行、id・title が空の行は null。公開可否は呼び出し側で判定する。 */
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

/** status（旧 visibility_status）が public の行だけを VideoCardData にする。 */
export function normalizePublicVideoCard(value: unknown): VideoCardData | null {
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

export function normalizePublicVideoCardList(value: unknown): VideoCardData[] {
  return Array.isArray(value)
    ? value
        .map(normalizePublicVideoCard)
        .filter((row): row is VideoCardData => row !== null)
    : [];
}
