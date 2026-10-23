/**
 * CURRENT static video rows -> ui card props (MIG-0505). Link, thumbnail URL, creator icon and date label are
 * CURRENT `VideoCard` / `ListIndexView` / `RankedVideoCard` rules, through their pure helpers.
 */
import type { VideoCardData } from "../../../../src/components/video/VideoCard.tsx";
import type { TrendingItem } from "../../../../src/lib/publicData/staticTrendingCore.ts";
import { cachedGoogleImageUrl } from "../../../../src/lib/media/googleImages.ts";
import { youtubeThumbUrl } from "../../../../src/lib/youtube/id.ts";
import { formatUnix } from "../../../../src/lib/utils/format.ts";
import type { ListVideo, TrendingRow } from "@flamenode/ui";

const href = (v: Pick<VideoCardData, "id" | "youtube_video_id">): string => `/${v.youtube_video_id?.trim() || v.id}`;
const thumb = (v: Pick<VideoCardData, "youtube_video_id">): string | null => youtubeThumbUrl(v.youtube_video_id, "mqdefault") || null;

export function toListVideo(v: VideoCardData & { primary_event_title?: string | null }): ListVideo {
  return {
    id: v.id,
    href: href(v),
    title: v.title,
    thumbnailUrl: thumb(v),
    creatorName: v.display_name,
    creatorIconUrl: cachedGoogleImageUrl(v.icon_url) || null,
    eventId: v.primary_event_id,
    eventTitle: v.primary_event_title ?? null,
    dateLabel: formatUnix(v.scheduled_time, { dateOnly: true }),
  };
}

export function toTrendingRow(item: TrendingItem, index: number): TrendingRow {
  return {
    id: item.id,
    rank: item.rank ?? index + 1,
    href: href(item),
    title: item.title,
    thumbnailUrl: thumb(item),
    creatorName: item.display_name,
    creatorIconUrl: cachedGoogleImageUrl(item.icon_url) || null,
    eventId: item.primary_event_id,
    eventTitle: item.primary_event_title,
    weeklyViews: item.views_7d,
  };
}
