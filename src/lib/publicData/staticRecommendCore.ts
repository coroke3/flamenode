import type { VideoCardData } from "@/components/video/VideoCard";
import {
  normalizeCount,
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeNullableString,
  normalizePresentString as normalizeString,
} from "./normalize.ts";
import { isPublicVideoListable } from "./visibility.ts";

export const RECOMMEND_CORE_OBJECT_KEY = "recommend/core.v1.json";
export const RECOMMEND_CORE_SCHEMA_VERSION = 1 as const;

export interface StaticRecommendCorePayload {
  schema_version?: unknown;
  generated_at?: unknown;
  recommended?: unknown;
  latest?: unknown;
  underrated?: unknown;
}

export interface StaticRecommendCoreData {
  generatedAt: number;
  recommended: VideoCardData[];
  latest: VideoCardData[];
  underrated: VideoCardData[];
}

export function normalizeRecommendCore(value: unknown): StaticRecommendCoreData | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as StaticRecommendCorePayload;
  if (Number(payload.schema_version) !== RECOMMEND_CORE_SCHEMA_VERSION) return null;
  if (!Array.isArray(payload.recommended) || !Array.isArray(payload.latest)) return null;
  if (!Array.isArray(payload.underrated)) return null;
  const generatedAt = normalizeUnix(payload.generated_at);
  if (generatedAt == null || generatedAt <= 0) return null;
  return {
    generatedAt,
    recommended: normalizeVideoList(payload.recommended),
    latest: normalizeVideoList(payload.latest),
    underrated: normalizeVideoList(payload.underrated),
  };
}

export interface StaticRecommendPayload {
  generated_at?: unknown;
  recommended?: unknown;
  latest?: unknown;
  underrated?: unknown;
  creators?: unknown;
}

export interface StaticRecommendCreator {
  id: string;
  x_name: string;
  icon_url: string | null;
  video_count: number;
  collab_count: number;
}

export interface StaticRecommendPools {
  generatedAt: number | null;
  recommended: VideoCardData[];
  latest: VideoCardData[];
  underrated: VideoCardData[];
  creators: StaticRecommendCreator[];
}

export interface StaticRecommendViewModel {
  hero: VideoCardData | undefined;
  hot: VideoCardData[];
  fresh: VideoCardData[];
  underrated: VideoCardData[];
  eventsRail: VideoCardData[];
  more: VideoCardData[];
  creators: StaticRecommendCreator[];
}

export function normalizeStaticRecommend(
  payload: StaticRecommendPayload,
): StaticRecommendPools | null {
  const recommended = normalizeVideoList(payload.recommended);
  const latest = normalizeVideoList(payload.latest);
  const underrated = normalizeVideoList(payload.underrated);
  const creators = normalizeCreatorList(payload.creators);
  if (
    recommended.length === 0 &&
    latest.length === 0 &&
    underrated.length === 0 &&
    creators.length === 0
  ) {
    return null;
  }
  return {
    generatedAt: normalizeUnix(payload.generated_at),
    recommended,
    latest,
    underrated,
    creators,
  };
}

export function buildRecommendViewModel(
  pools: Pick<
    StaticRecommendPools,
    "recommended" | "latest" | "underrated" | "creators"
  >,
): StaticRecommendViewModel {
  const {
    recommended = [],
    latest = [],
    underrated: underratedPool = [],
    creators = [],
  } = pools;

  const allCandidates = uniqueVideos([
    ...recommended,
    ...latest,
    ...underratedPool,
  ]);

  const hero = recommended[0] ?? latest[0] ?? underratedPool[0];
  const allNonHero = withoutVideo(allCandidates, hero?.id);
  const nonHeroRecommended = withoutVideo(recommended, hero?.id);
  const nonHeroLatest = withoutVideo(latest, hero?.id);
  const nonHeroUnderrated = withoutVideo(underratedPool, hero?.id);

  const hot = buildRail(nonHeroRecommended, allNonHero, 18, {
    maxPerCreator: 3,
    maxPerEvent: 5,
  });
  const fresh = buildRail(nonHeroLatest, allNonHero, 18, {
    maxPerCreator: 3,
    maxPerEvent: 5,
  });
  const underrated = buildRail(nonHeroUnderrated, allNonHero, 14, {
    maxPerCreator: 2,
    maxPerEvent: 4,
  });

  const eventsRail: VideoCardData[] = [];
  const seenEvents = new Set<string>();
  for (const video of allNonHero) {
    if (!video.primary_event_id || seenEvents.has(video.primary_event_id)) {
      continue;
    }
    seenEvents.add(video.primary_event_id);
    eventsRail.push(video);
    if (eventsRail.length >= 16) break;
  }
  if (eventsRail.length < 12) {
    eventsRail.push(
      ...allNonHero
        .filter((video) => !eventsRail.some((shown) => shown.id === video.id))
        .slice(0, 16 - eventsRail.length),
    );
  }

  const shown = new Set(
    [
      hero?.id,
      ...hot.map((video) => video.id),
      ...fresh.map((video) => video.id),
      ...underrated.map((video) => video.id),
      ...eventsRail.map((video) => video.id),
    ].filter(Boolean),
  );
  const morePool = allCandidates.filter((video) => !shown.has(video.id));
  const more = pickDiverseVideos(
    morePool.length > 0 ? morePool : allNonHero,
    {
      target: 36,
      maxPerCreator: 4,
      maxPerEvent: 8,
    },
  );

  return {
    hero,
    hot,
    fresh,
    underrated,
    eventsRail,
    more,
    creators,
  };
}

function pickDiverseVideos<
  T extends {
    id: string;
    creator_x_user_id?: string | null;
    primary_event_id?: string | null;
  },
>(
  rows: readonly T[],
  options: { target: number; maxPerCreator?: number; maxPerEvent?: number },
): T[] {
  const target = Math.max(0, options.target);
  const maxPerCreator = options.maxPerCreator ?? 3;
  const maxPerEvent = options.maxPerEvent ?? 5;
  const creatorCounts = new Map<string, number>();
  const eventCounts = new Map<string, number>();
  const out: T[] = [];
  const skipped: T[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    const creatorId = row.creator_x_user_id;
    const eventId = row.primary_event_id;
    if (creatorId && (creatorCounts.get(creatorId) ?? 0) >= maxPerCreator) {
      skipped.push(row);
      continue;
    }
    if (eventId && (eventCounts.get(eventId) ?? 0) >= maxPerEvent) {
      skipped.push(row);
      continue;
    }
    seen.add(row.id);
    if (creatorId) {
      creatorCounts.set(creatorId, (creatorCounts.get(creatorId) ?? 0) + 1);
    }
    if (eventId) {
      eventCounts.set(eventId, (eventCounts.get(eventId) ?? 0) + 1);
    }
    out.push(row);
    if (out.length >= target) return out;
  }

  for (const row of skipped) {
    if (out.length >= target) break;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }

  return out;
}

function uniqueVideos<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function withoutVideo<T extends { id: string }>(
  rows: readonly T[],
  id?: string,
): T[] {
  return id ? rows.filter((row) => row.id !== id) : [...rows];
}

function buildRail(
  primary: readonly VideoCardData[],
  fallback: readonly VideoCardData[],
  target: number,
  options: { maxPerCreator?: number; maxPerEvent?: number } = {},
): VideoCardData[] {
  return pickDiverseVideos(uniqueVideos([...primary, ...fallback]), {
    target,
    ...options,
  });
}

function normalizeVideoList(value: unknown): VideoCardData[] {
  return Array.isArray(value)
    ? value
        .map(normalizeVideo)
        .filter((row): row is VideoCardData => row !== null)
    : [];
}

function normalizeVideo(value: unknown): VideoCardData | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  if (!id || !title || !isPublicVideoListable(row.status ?? row.visibility_status)) {
    return null;
  }
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
    creator_x_user_id: normalizeNullableString(row.creator_x_user_id),
    primary_event_id: normalizeNullableString(row.primary_event_id),
    scheduled_time: normalizeUnix(row.scheduled_time),
    status: "public",
    part: normalizeNullableString(row.part),
  };
}

function normalizeCreatorList(value: unknown): StaticRecommendCreator[] {
  return Array.isArray(value)
    ? value
        .map(normalizeCreator)
        .filter((row): row is StaticRecommendCreator => row !== null)
    : [];
}

function normalizeCreator(value: unknown): StaticRecommendCreator | null {
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
