import type { PublicEventCardEvent } from "@/components/event/PublicEventCard";
import type { RecruitEvent } from "@/components/layout/EventRecruitCard";
import type { HomeIntroSlotStat } from "@/components/layout/HomeIntroBand";
import type { HomeStats } from "@/components/layout/homeVisuals";
import type { VideoCardData } from "@/components/video/VideoCard";
import type { PublicAnnouncement } from "@/lib/db/announcementQueries";
import {
  normalizeCount,
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeNullableString,
  normalizePresentString as normalizeString,
} from "./normalize.ts";
import { normalizePublicEventVisibility } from "./visibility.ts";

export interface StaticTopPayload {
  generated_at?: unknown;
  recommended?: unknown;
  latest?: unknown;
  items?: unknown;
  creators?: unknown;
  active_events?: unknown;
  latest_events?: unknown;
  announcements?: unknown;
  slot_stats?: unknown;
  event_video_counts?: unknown;
  stats?: unknown;
}

export type StaticTopEvent = RecruitEvent & PublicEventCardEvent;

export interface StaticTopCreator {
  id: string;
  x_name: string;
  icon_url: string | null;
  video_count: number;
  collab_count: number;
}

export interface StaticTopData {
  generatedAt: number | null;
  activeEvents: StaticTopEvent[];
  recommended: VideoCardData[];
  latest: VideoCardData[];
  creators: StaticTopCreator[];
  latestEvents: StaticTopEvent[];
  announcements: PublicAnnouncement[];
  eventVideoCounts: Record<string, number>;
  topSlotStats: Map<string, HomeIntroSlotStat>;
  stats: HomeStats;
}

export function normalizeStaticTop(payload: StaticTopPayload): StaticTopData | null {
  const recommendedSource = Array.isArray(payload.recommended)
    ? payload.recommended
    : payload.items;
  const latestSource = Array.isArray(payload.latest) ? payload.latest : payload.items;

  const recommended = normalizeVideoList(recommendedSource).slice(0, 30);
  const latest = normalizeVideoList(latestSource).slice(0, 30);
  const activeEvents = normalizeEventList(payload.active_events);
  const latestEvents = normalizeEventList(payload.latest_events).slice(0, 4);
  const creators = normalizeCreatorList(payload.creators).slice(0, 30);
  const announcements = normalizeAnnouncementList(payload.announcements).slice(0, 3);
  const eventVideoCounts = normalizeCountMap(payload.event_video_counts);
  const topSlotStats = normalizeSlotStats(payload.slot_stats);
  const stats = normalizeStats(payload.stats, {
    publicVideos: latest.length,
    activeEvents: activeEvents.length,
    creators: creators.length,
  });

  if (
    recommended.length === 0 &&
    latest.length === 0 &&
    activeEvents.length === 0 &&
    latestEvents.length === 0 &&
    creators.length === 0 &&
    announcements.length === 0
  ) {
    return null;
  }

  return {
    generatedAt: normalizeUnix(payload.generated_at),
    activeEvents,
    recommended,
    latest,
    creators,
    latestEvents,
    announcements,
    eventVideoCounts,
    topSlotStats,
    stats,
  };
}

function normalizeVideoList(value: unknown): VideoCardData[] {
  return Array.isArray(value)
    ? value.map(normalizeVideo).filter((row): row is VideoCardData => row !== null)
    : [];
}

function normalizeVideo(value: unknown): VideoCardData | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    youtube_video_id: normalizeNullableString(row.youtube_video_id),
    display_name:
      normalizeString(row.display_name) ??
      normalizeString(row.creator_display_name) ??
      "unknown",
    icon_url:
      normalizeNullableString(row.icon_url) ??
      normalizeNullableString(row.creator_icon_url),
    primary_event_id: normalizeNullableString(row.primary_event_id),
    scheduled_time: normalizeUnix(row.scheduled_time),
    status: normalizeNullableString(row.status) ?? "public",
    part: normalizeNullableString(row.part),
  };
}

function normalizeEventList(value: unknown): StaticTopEvent[] {
  return Array.isArray(value)
    ? value.map(normalizeEvent).filter((row): row is StaticTopEvent => row !== null)
    : [];
}

function normalizeEvent(value: unknown): StaticTopEvent | null {
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
    visibility_status: visibility,
    start_time: normalizeUnix(row.start_time),
    end_time: normalizeUnix(row.end_time),
    entry_start_time: normalizeUnix(row.entry_start_time),
    entry_end_time: normalizeUnix(row.entry_end_time),
    created_at: normalizeUnix(row.created_at),
  };
}

function normalizeCreatorList(value: unknown): StaticTopCreator[] {
  return Array.isArray(value)
    ? value
        .map(normalizeCreator)
        .filter((row): row is StaticTopCreator => row !== null)
    : [];
}

function normalizeCreator(value: unknown): StaticTopCreator | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const xName = normalizeString(row.x_name);
  if (!id || !xName) return null;
  return {
    id,
    x_name: xName,
    icon_url: normalizeNullableString(row.icon_url),
    video_count: normalizeCount(row.video_count) ?? 0,
    collab_count: normalizeCount(row.collab_count) ?? 0,
  };
}

function normalizeAnnouncementList(value: unknown): PublicAnnouncement[] {
  return Array.isArray(value)
    ? value
        .map(normalizeAnnouncement)
        .filter((row): row is PublicAnnouncement => row !== null)
    : [];
}

function normalizeAnnouncement(value: unknown): PublicAnnouncement | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  const body = normalizeString(row.body);
  if (!id || !title || !body) return null;
  return {
    id,
    title,
    body,
    severity: normalizeSeverity(row.severity),
    publish_at: normalizeUnix(row.publish_at),
    expire_at: normalizeUnix(row.expire_at),
  };
}

function normalizeCountMap(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const eventId = normalizeString(row.event_id);
    const count = normalizeCount(row.count ?? row.c);
    if (eventId && count != null) result[eventId] = count;
  }
  return result;
}

function normalizeSlotStats(value: unknown): Map<string, HomeIntroSlotStat> {
  const result = new Map<string, HomeIntroSlotStat>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const eventId = normalizeString(row.event_id);
    if (!eventId) continue;
    result.set(eventId, {
      available: normalizeCount(row.available) ?? 0,
      total: normalizeCount(row.total) ?? 0,
    });
  }
  return result;
}

function normalizeStats(value: unknown, fallback: HomeStats): HomeStats {
  if (!value || typeof value !== "object") return fallback;
  const row = value as Record<string, unknown>;
  return {
    publicVideos: normalizeCount(row.publicVideos ?? row.public_videos) ?? fallback.publicVideos,
    activeEvents: normalizeCount(row.activeEvents ?? row.active_events) ?? fallback.activeEvents,
    creators: normalizeCount(row.creators) ?? fallback.creators,
  };
}

function normalizeSeverity(value: unknown): PublicAnnouncement["severity"] {
  if (value === "info" || value === "warning" || value === "danger") {
    return value;
  }
  return null;
}
