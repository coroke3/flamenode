/**
 * `/event/[id]` and `/event/[id]/slots` view models (MIG-0502 U02/U03): CURRENT's
 * `app/(public)/event/[id]/page.tsx` rules as pure functions of the build-time detail and a clock, so the
 * build and the browser Island produce the same model. Slot state (filled counts, names) is never an input
 * of the static HTML: it comes only from `live` (RH-020), which the Island fetches in the browser.
 */
import type { EventDetailData, EventSlotPart } from "@flamenode/ui";
import type { StaticEventDetail, StaticEventSlot } from "../../../../src/lib/publicData/staticEventDetailCore.ts";
import { buildSlotParts } from "../../../../src/lib/utils/slotGroupingCore.ts";
import {
  computeEventStatus,
  eventStatusLabel,
  isAcceptingEntries,
} from "../../../../src/lib/utils/eventStatusCore.ts";
import { formatPublicationDateTime } from "../../../../src/lib/utils/format.ts";
import { cachedGoogleImageUrl } from "../../../../src/lib/media/googleImages.ts";
import { youtubeThumbUrl } from "../../../../src/lib/youtube/id.ts";
import { extractYoutubePlaylistId } from "../../../../src/lib/youtube/playlist.ts";
import { absoluteUrl, compactText } from "./pageHead.ts";

export const EVENT_VIDEO_DISPLAY_LIMIT = 8;

/** RH-020 `GET /api/live/events/{id}/slots` rows (the part this page reads). */
export type LiveSlotStatus = Readonly<{ slots: readonly { id: string; status: string }[] }>;

const JST = { timeZone: "Asia/Tokyo" } as const;
const monthDay = new Intl.DateTimeFormat("ja-JP", { ...JST, month: "2-digit", day: "2-digit" });

/** CURRENT `formatRange`: `MM/DD - MM/DD`, `-` for a missing end. */
export function formatEventRange(start: number | null, end: number | null): string {
  if (start == null && end == null) return "-";
  return `${start != null ? monthDay.format(new Date(start * 1000)) : "-"} - ${
    end != null ? monthDay.format(new Date(end * 1000)) : "-"
  }`;
}

/** CURRENT `getDayMetric`. */
export function getDayMetric(
  event: Pick<StaticEventDetail["event"], "start_time" | "entry_end_time" | "end_time">,
  now: number,
): { label: string; days: number } {
  const target = [
    { at: event.start_time, label: "投稿期間まで" },
    { at: event.entry_end_time, label: "募集締切まで" },
    { at: event.end_time, label: "終了まで" },
  ].find((item): item is { at: number; label: string } => typeof item.at === "number" && item.at > now);
  return target
    ? { label: target.label, days: Math.max(0, Math.ceil((target.at - now) / 86400)) }
    : { label: "終了", days: 0 };
}

/** Time layout of the slots (ids, time, order): structure only, no status. */
export type SlotLayoutRow = Readonly<{ id: string; start_time: number | null; sort_order: number | null }>;
export function slotLayoutOf(detail: StaticEventDetail): SlotLayoutRow[] {
  return detail.slots.map((s: StaticEventSlot) => ({ id: s.id, start_time: s.start_time, sort_order: s.sort_order }));
}

function partLabel(index: number, isTimeless: boolean, configured: readonly string[]): string {
  if (isTimeless) return "時間なし枠";
  return configured[index - 1]?.trim() || `第${index}部`;
}

/** CURRENT `buildSlotSummary(...).parts` with `formatSlotPartLabel(part, "short", configured)`. */
export function slotPartsOf(
  layout: readonly SlotLayoutRow[],
  gapMinutes: number | null,
  configuredParts: readonly string[],
  live: LiveSlotStatus | null,
): EventSlotPart[] {
  const liveStatus = live ? new Map(live.slots.map((s) => [s.id, s.status])) : null;
  const gapSec = (gapMinutes ?? 15) * 60;
  return buildSlotParts([...layout], gapSec).map((part) => ({
    label: partLabel(part.index, part.is_timeless, configuredParts),
    total: part.rows.length,
    filled: liveStatus ? part.rows.filter((row) => (liveStatus.get(row.id) ?? "available") !== "available").length : null,
  }));
}

export function buildEventDetailData(
  detail: StaticEventDetail,
  now: number,
  live: LiveSlotStatus | null = null,
): EventDetailData {
  const { event } = detail;
  const status = computeEventStatus(event, now);
  const accepting = isAcceptingEntries(event, now);
  const inPostPeriod =
    !accepting &&
    event.entry_end_time != null &&
    now >= event.entry_end_time &&
    event.start_time != null &&
    now < event.start_time;
  const layout = slotLayoutOf(detail);
  const parts = slotPartsOf(layout, event.slot_part_gap_minutes, event.parts, live);
  const slotFilled = live
    ? (() => {
        const byId = new Map(live.slots.map((s) => [s.id, s.status]));
        return layout.filter((row) => (byId.get(row.id) ?? "available") !== "available").length;
      })()
    : null;
  const playlistId = extractYoutubePlaylistId(event.youtube_playlist_id ?? "");
  const showPublicationTime = status === "scheduled" || status === "active";
  return {
    id: event.id,
    title: event.title,
    imageUrl: event.img_url ?? event.icon_url,
    iconUrl: event.icon_url,
    explanation: event.explanation,
    statusLabel: accepting ? "募集期間中" : eventStatusLabel(status),
    // CURRENT `eventStatusBadgeClass`: accent (active/published) / warning (scheduled) / neutral (ended).
    statusTone: accepting ? "public" : status === "scheduled" ? "warning" : status === "ended" ? "draft" : "live",
    periodLabel: null,
    entryAction: accepting ? "reserve" : inPostPeriod ? "submit" : null,
    playlistUrl: playlistId ? `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}` : null,
    videoTotal: detail.videoTotal,
    creatorTotal: detail.creatorCount,
    slotFilled,
    slotTotal: layout.length,
    dayMetric: getDayMetric(event, now),
    schedule: [
      { label: "募集期間", value: formatEventRange(event.entry_start_time, event.entry_end_time) },
      { label: "投稿期間", value: formatEventRange(event.start_time, event.end_time) },
    ],
    slotParts: parts,
    staff: detail.publicStaff.map((member) => ({
      name: member.display_name,
      roleLabel: member.public_role_label,
      iconUrl: member.icon_url,
      xUserId: member.x_user_id,
      profileHref: member.x_user_id && member.has_public_profile ? `/user/${member.x_user_id}` : null,
    })),
    videos: detail.publicVideos.slice(0, EVENT_VIDEO_DISPLAY_LIMIT).map((video) => ({
      id: video.id,
      youtubeVideoId: video.youtube_video_id,
      title: video.title,
      thumbnailUrl: youtubeThumbUrl(video.youtube_video_id, "mqdefault") || null,
      creatorName: video.creator_display_name,
      creatorIconUrl: cachedGoogleImageUrl(video.creator_icon_url),
      metaLabel: showPublicationTime ? formatPublicationDateTime(video.scheduled_time) : null,
    })),
  };
}

/** CURRENT `eventJsonLd` of `event/[id]/page.tsx` (G06). Keys with no value are left out like JSON.stringify drops `undefined`. */
export function buildEventJsonLd(event: StaticEventDetail["event"], origin?: string): Record<string, unknown> {
  const image = event.img_url ?? event.icon_url;
  const url = absoluteUrl(`/event/${event.id}`, origin);
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: compactText(event.explanation),
    url,
    image: image ? [absoluteUrl(image, origin)] : undefined,
    startDate: event.start_time ? new Date(event.start_time * 1000).toISOString() : undefined,
    endDate: event.end_time ? new Date(event.end_time * 1000).toISOString() : undefined,
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    location: { "@type": "VirtualLocation", url },
    organizer: { "@type": "Organization", name: "FlameNode", url: absoluteUrl("/", origin) },
  };
}
