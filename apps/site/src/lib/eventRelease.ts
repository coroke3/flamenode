/**
 * `/event/[id]/release` view model (MIG-0502 U04): CURRENT `ReleaseView.tsx` ordering, JST date grouping and
 * links as a pure function of the build-time release object. No clock input: the page is the same all day.
 */
import type { EventReleaseViewModel, ReleaseVideoView } from "@flamenode/ui";
import type { StaticEventRelease, StaticEventReleaseVideo } from "../../../../src/lib/publicData/staticEventReleaseCore.ts";
import { extractYoutubeId, youtubeThumbUrl } from "../../../../src/lib/youtube/id.ts";

const dateKeyFormatter = new Intl.DateTimeFormat("ja-JP-u-ca-gregory", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function unixToDate(timestamp: number | null): Date | null {
  if (timestamp == null || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatDateKey(timestamp: number | null): string {
  const date = unixToDate(timestamp);
  if (!date) return "日時未定";
  const parts = dateKeyFormatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const [year, month, day] = [get("year"), get("month"), get("day")];
  return year && month && day ? `${year}/${month}/${day}` : "日時未定";
}

export function formatTime(timestamp: number | null): string {
  const date = unixToDate(timestamp);
  if (!date) return "--:--";
  const parts = timeFormatter.formatToParts(date);
  return `${parts.find((p) => p.type === "hour")?.value ?? "00"}:${parts.find((p) => p.type === "minute")?.value ?? "00"}`;
}

/** CURRENT `compareReleaseVideos`. */
export function compareReleaseVideos(left: StaticEventReleaseVideo, right: StaticEventReleaseVideo): number {
  const l = left.scheduled_time;
  const r = right.scheduled_time;
  if (l == null && r == null) return left.id.localeCompare(right.id);
  if (l == null) return 1;
  if (r == null) return -1;
  return l - r || left.id.localeCompare(right.id);
}

function toView(video: StaticEventReleaseVideo): ReleaseVideoView {
  const youtubeId = extractYoutubeId(video.youtube_video_id);
  return {
    id: video.id,
    title: video.title,
    timeLabel: formatTime(video.scheduled_time),
    collab: video.collaboration_type === "collab",
    part: video.part?.trim() || null,
    creatorName: video.creator_display_name,
    creatorXUserId: video.creator_x_user_id?.trim() || null,
    creatorIconUrl: video.creator_icon_url,
    detailHref: `/${encodeURIComponent(youtubeId || video.id)}`,
    watchHref: youtubeId ? `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}` : null,
    thumbnailUrl: youtubeId ? youtubeThumbUrl(youtubeId, "maxresdefault") || null : null,
    introComment: video.intro_comment,
    members: (video.members ?? []).map((m) => ({
      name: m.name,
      xUserId: m.x_user_id,
      role: m.role,
      comment: m.comment,
      key: `${video.id}:${m.order_index}:${m.name}`,
    })),
  };
}

export function buildEventReleaseModel(release: StaticEventRelease): EventReleaseViewModel {
  const ordered = [...release.videos].sort(compareReleaseVideos);
  const groups = new Map<string, ReleaseVideoView[]>();
  const videos = ordered.map(toView);
  ordered.forEach((video, i) => {
    const key = formatDateKey(video.scheduled_time);
    groups.set(key, [...(groups.get(key) ?? []), videos[i]]);
  });
  return {
    eventId: release.event.id,
    eventTitle: release.event.title,
    groups: [...groups.entries()].map(([date, list]) => ({ date, videos: list })),
    videos,
    truncated: release.truncated,
  };
}
