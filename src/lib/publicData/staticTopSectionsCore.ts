import type { PublicAnnouncement } from "@/lib/db/announcementQueries";
import {
  normalizeCount,
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeNullableString,
  normalizePresentString as normalizeString,
} from "./normalize.ts";
import { normalizeStaticTop, type StaticTopEvent } from "./staticTopCore.ts";

export const TOP_SECTIONS_SCHEMA_VERSION = 1 as const;

export const TOP_RECOMMENDED_OBJECT_KEY = "top/sections/recommended.v1.json";
export const TOP_LATEST_OBJECT_KEY = "top/sections/latest.v1.json";
export const TOP_NOSTALGIC_OBJECT_KEY = "top/sections/nostalgic.v1.json";
export const TOP_EVENTS_OBJECT_KEY = "top/sections/events.v1.json";
export const TOP_ANNOUNCEMENTS_OBJECT_KEY = "top/sections/announcements.v1.json";
export const TOP_STATS_OBJECT_KEY = "top/sections/stats.v1.json";

export const TOP_SECTION_OBJECT_KEYS = [
  TOP_RECOMMENDED_OBJECT_KEY,
  TOP_LATEST_OBJECT_KEY,
  TOP_NOSTALGIC_OBJECT_KEY,
  TOP_EVENTS_OBJECT_KEY,
  TOP_ANNOUNCEMENTS_OBJECT_KEY,
  TOP_STATS_OBJECT_KEY,
] as const;

export type TopVideoSectionData = {
  generatedAt: number;
  items: ReturnType<typeof normalizeStaticTop> extends infer T
    ? T extends { recommended: infer R }
      ? R
      : never
    : never;
};

export type TopNostalgicSectionData = {
  generatedAt: number;
  pool: TopVideoSectionData["items"];
  display: TopVideoSectionData["items"];
  shuffledAt: number;
  selectionDay: string;
};

export type TopEventsSectionData = {
  generatedAt: number;
  activeEvents: StaticTopEvent[];
  latestEvents: StaticTopEvent[];
};

export type TopAnnouncementsSectionData = {
  generatedAt: number;
  items: PublicAnnouncement[];
};

export type TopStatsSectionData = {
  generatedAt: number;
  stats: {
    public_videos: number;
    active_events: number;
    public_events: number;
    creators: number;
  };
};

function normalizeVideoItems(value: unknown): TopVideoSectionData["items"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const normalized = normalizeStaticTop({
        recommended: [row],
        latest: [row],
        items: [row],
      });
      return normalized?.recommended[0] ?? null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

export function normalizeTopRecommendedSection(value: unknown): TopVideoSectionData | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (Number(payload.schema_version) !== TOP_SECTIONS_SCHEMA_VERSION) return null;
  const generatedAt = normalizeUnix(payload.generated_at);
  if (generatedAt == null || generatedAt <= 0) return null;
  const source = payload.items ?? payload.recommended;
  if (!Array.isArray(source)) return null;
  return { generatedAt, items: normalizeVideoItems(source) };
}

export function normalizeTopLatestSection(value: unknown): TopVideoSectionData | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (Number(payload.schema_version) !== TOP_SECTIONS_SCHEMA_VERSION) return null;
  const generatedAt = normalizeUnix(payload.generated_at);
  if (generatedAt == null || generatedAt <= 0) return null;
  const source = payload.items ?? payload.latest;
  if (!Array.isArray(source)) return null;
  return { generatedAt, items: normalizeVideoItems(source) };
}

export function normalizeTopNostalgicSection(value: unknown): TopNostalgicSectionData | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (Number(payload.schema_version) !== TOP_SECTIONS_SCHEMA_VERSION) return null;
  const generatedAt = normalizeUnix(payload.generated_at);
  const shuffledAt = normalizeUnix(payload.shuffled_at);
  const selectionDay = normalizeString(payload.selection_day);
  if (generatedAt == null || generatedAt <= 0) return null;
  if (shuffledAt == null || shuffledAt <= 0) return null;
  if (!selectionDay) return null;
  if (!Array.isArray(payload.pool) || !Array.isArray(payload.display)) return null;
  return {
    generatedAt,
    pool: normalizeVideoItems(payload.pool),
    display: normalizeVideoItems(payload.display),
    shuffledAt,
    selectionDay,
  };
}

export function normalizeTopEventsSection(value: unknown): TopEventsSectionData | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (Number(payload.schema_version) !== TOP_SECTIONS_SCHEMA_VERSION) return null;
  const generatedAt = normalizeUnix(payload.generated_at);
  if (generatedAt == null || generatedAt <= 0) return null;
  if (!Array.isArray(payload.active_events) || !Array.isArray(payload.latest_events)) {
    return null;
  }
  const activeNormalized = normalizeStaticTop({
    active_events: payload.active_events,
    latest: [{ id: "x", title: "x" }],
  });
  const latestNormalized = normalizeStaticTop({
    latest_events: payload.latest_events,
    latest: [{ id: "x", title: "x" }],
  });
  return {
    generatedAt,
    activeEvents: activeNormalized?.activeEvents ?? [],
    latestEvents: latestNormalized?.latestEvents ?? [],
  };
}

function normalizeAnnouncementItems(value: unknown): PublicAnnouncement[] {
  const normalized = normalizeStaticTop({ announcements: value });
  return normalized?.announcements ?? [];
}

export function normalizeTopAnnouncementsSection(
  value: unknown,
): TopAnnouncementsSectionData | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (Number(payload.schema_version) !== TOP_SECTIONS_SCHEMA_VERSION) return null;
  const generatedAt = normalizeUnix(payload.generated_at);
  if (generatedAt == null || generatedAt <= 0) return null;
  const source = payload.items ?? payload.announcements;
  if (!Array.isArray(source)) return null;
  return {
    generatedAt,
    items: normalizeAnnouncementItems(source),
  };
}

export function normalizeTopStatsSection(value: unknown): TopStatsSectionData | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (Number(payload.schema_version) !== TOP_SECTIONS_SCHEMA_VERSION) return null;
  const generatedAt = normalizeUnix(payload.generated_at);
  if (generatedAt == null || generatedAt <= 0) return null;
  if (!payload.stats || typeof payload.stats !== "object") return null;
  const statsRow = payload.stats as Record<string, unknown>;
  return {
    generatedAt,
    stats: {
      public_videos: normalizeCount(statsRow.public_videos) ?? 0,
      active_events: normalizeCount(statsRow.active_events) ?? 0,
      public_events: normalizeCount(statsRow.public_events) ?? 0,
      creators: normalizeCount(statsRow.creators) ?? 0,
    },
  };
}
