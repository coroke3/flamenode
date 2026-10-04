import type { VideoCardData } from "@/components/video/VideoCard";
import {
  normalizeCount,
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeNullableString,
  normalizePresentString as normalizeString,
} from "./normalize.ts";
import { normalizePublicVideoCardList } from "./staticVideoCardCore.ts";

export const STATIC_USER_WORKS_PAGE_SIZE = 24;
export const STATIC_USER_COLLABS_PAGE_SIZE = 24;
export const STATIC_USER_MAX_PAGES = 5;
export const STATIC_USER_MAX_STATIC_ITEMS =
  STATIC_USER_WORKS_PAGE_SIZE * STATIC_USER_MAX_PAGES;

export interface StaticUserVideoSectionPayload {
  total?: unknown;
  items?: unknown;
}

export interface StaticUserProfilePayload {
  generated_at?: unknown;
  user?: Record<string, unknown>;
  page_size?: unknown;
  works?: StaticUserVideoSectionPayload;
  collabs?: StaticUserVideoSectionPayload;
  /** @deprecated legacy single-file shape */
  recent_videos?: unknown;
  /** @deprecated legacy single-file shape */
  total_works?: unknown;
}

export interface StaticUserVideoPagePayload {
  generated_at?: unknown;
  page?: unknown;
  page_size?: unknown;
  total?: unknown;
  items?: unknown;
}

export interface StaticUserVideoSection {
  total: number;
  items: VideoCardData[];
  pageSize: number;
}

export interface StaticUserVideoPage {
  page: number;
  total: number;
  items: VideoCardData[];
  pageSize: number;
  generatedAt: number | null;
}

export interface StaticUserProfile {
  generatedAt: number | null;
  user: {
    id: string;
    x_name: string;
    icon_url: string | null;
    profile_text: string | null;
    portfolio_contact: string | null;
    youtube_channel_url: string | null;
    other_social_links: string | null;
  };
  works: StaticUserVideoSection;
  collabs: StaticUserVideoSection;
}

export function normalizeStaticUserProfile(
  payload: StaticUserProfilePayload,
): StaticUserProfile | null {
  if (!payload.user || typeof payload.user !== "object") return null;
  const userRow = payload.user as Record<string, unknown>;
  const id = normalizeString(userRow.id);
  const xName = normalizeString(userRow.x_name) ?? id;
  if (!id || !xName) return null;

  const worksPageSize =
    normalizeCount(payload.page_size) ?? STATIC_USER_WORKS_PAGE_SIZE;
  const works = normalizeVideoSection(
    payload.works,
    payload.recent_videos,
    payload.total_works,
    worksPageSize,
  );
  const collabs = normalizeVideoSection(
    payload.collabs,
    [],
    0,
    STATIC_USER_COLLABS_PAGE_SIZE,
  );

  return {
    generatedAt: normalizeUnix(payload.generated_at),
    user: {
      id,
      x_name: xName,
      icon_url: normalizeNullableString(userRow.icon_url),
      profile_text: normalizeNullableString(userRow.profile_text),
      portfolio_contact: normalizeNullableString(userRow.portfolio_contact),
      youtube_channel_url: normalizeNullableString(userRow.youtube_channel_url),
      other_social_links: normalizeNullableString(userRow.other_social_links),
    },
    works,
    collabs,
  };
}

export function normalizeStaticUserVideoPage(
  payload: StaticUserVideoPagePayload,
  fallbackPage: number,
  fallbackPageSize: number,
): StaticUserVideoPage | null {
  const items = normalizeVideoList(payload.items);
  const pageSize = normalizeCount(payload.page_size) ?? fallbackPageSize;
  const page = normalizeCount(payload.page) ?? fallbackPage;
  const total = normalizeCount(payload.total) ?? items.length;
  if (page < 1 || pageSize < 1) return null;
  return {
    page,
    total,
    items,
    pageSize,
    generatedAt: normalizeUnix(payload.generated_at),
  };
}

function normalizeVideoSection(
  section: StaticUserVideoSectionPayload | undefined,
  legacyItems: unknown,
  legacyTotal: unknown,
  pageSize: number,
): StaticUserVideoSection {
  const itemsSource = section?.items ?? legacyItems;
  const items = normalizeVideoList(itemsSource);
  const total =
    normalizeCount(section?.total) ??
    normalizeCount(legacyTotal) ??
    items.length;
  return {
    total,
    items,
    pageSize,
  };
}

function normalizeVideoList(value: unknown): VideoCardData[] {
  const seen = new Set<string>();
  return normalizePublicVideoCardList(value).filter((video) => {
    if (seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
}
