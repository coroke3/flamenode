import "server-only";

import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { loadPublicJson } from "./loader";
import { normalizeStaticEventsIndex } from "./staticEventsIndexCore";
import {
  normalizeStaticRecentVideoPage,
  type StaticRecentVideosPayload,
} from "./staticRecentVideoCore";
import {
  normalizeStaticSearchIndexPayload,
  type StaticSearchIndexPayload,
} from "./staticSearchIndexCore";
import { normalizeUnixDate } from "./normalize";

type SitemapEntry = MetadataRoute.Sitemap[number];

function unixDate(value: number | null | undefined): Date | undefined {
  return normalizeUnixDate(value) ?? undefined;
}

function entry(
  path: string,
  options: {
    lastModified?: Date;
    changeFrequency?: SitemapEntry["changeFrequency"];
    priority?: number;
  } = {},
): SitemapEntry {
  return {
    url: absoluteUrl(path),
    lastModified: options.lastModified ?? new Date(),
    changeFrequency: options.changeFrequency,
    priority: options.priority,
  };
}

export async function buildStaticSitemapEntries(): Promise<SitemapEntry[]> {
  const [recentResult, eventsResult, usersResult, searchResult] = await Promise.all([
    loadPublicJson<StaticRecentVideosPayload>({
      r2Key: "list/recent.json",
      targetType: "list_recent",
      targetId: "global",
      reason: "sitemap_recent_index",
    }),
    loadPublicJson<{ items?: unknown; generated_at?: unknown }>({
      r2Key: "events/index.json",
      targetType: "events_index",
      targetId: "global",
      reason: "sitemap_events_index",
    }),
    loadPublicJson<{ items?: unknown; generated_at?: unknown }>({
      r2Key: "users/index.json",
      targetType: "users_index",
      targetId: "global",
      reason: "sitemap_users_index",
    }),
    loadPublicJson<StaticSearchIndexPayload>({
      r2Key: "search-index-lite.json",
      targetType: "search_index",
      targetId: "global",
      reason: "sitemap_search_index",
    }),
  ]);

  const generatedAt = Math.max(
    recentResult.data?.generated_at ? Number(recentResult.data.generated_at) : 0,
    eventsResult.data?.generated_at ? Number(eventsResult.data.generated_at) : 0,
    usersResult.data?.generated_at ? Number(usersResult.data.generated_at) : 0,
    searchResult.data?.generated_at ? Number(searchResult.data.generated_at) : 0,
  );
  const fallbackModified = generatedAt > 0 ? unixDate(generatedAt) : undefined;

  const recentPage = recentResult.data
    ? normalizeStaticRecentVideoPage(recentResult.data, 1, 500)
    : null;
  const eventsIndex = eventsResult.data
    ? normalizeStaticEventsIndex(eventsResult.data)
    : null;
  const searchIndex = searchResult.data
    ? normalizeStaticSearchIndexPayload(searchResult.data)
    : null;

  const videoEntries =
    recentPage?.videos.map((video) =>
      entry(`/${encodeURIComponent(video.youtube_video_id ?? video.id)}`, {
        lastModified: unixDate(video.scheduled_time) ?? fallbackModified,
        changeFrequency: "weekly",
        priority: 0.7,
      }),
    ) ?? [];

  const eventEntries =
    eventsIndex?.events.map((event) =>
      entry(`/event/${encodeURIComponent(event.id)}`, {
        lastModified:
          unixDate(event.end_time ?? event.start_time) ??
          fallbackModified,
        changeFrequency: "weekly",
        priority: 0.7,
      }),
    ) ?? [];

  const creatorEntries = Array.isArray(usersResult.data?.items)
    ? usersResult.data.items
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          const id =
            typeof row.x_id === "string"
              ? row.x_id.trim()
              : typeof row.id === "string"
                ? row.id.trim()
                : "";
          if (!id) return null;
          return entry(`/user/${encodeURIComponent(id)}`, {
            lastModified:
              unixDate(
                typeof row.updated_at === "number" ? row.updated_at : null,
              ) ?? fallbackModified,
            changeFrequency: "weekly",
            priority: 0.6,
          });
        })
        .filter((row): row is SitemapEntry => row !== null)
    : Array.isArray(searchIndex?.users)
      ? searchIndex.users
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const row = item as Record<string, unknown>;
            const id = typeof row.id === "string" ? row.id.trim() : "";
            if (!id) return null;
            return entry(`/user/${encodeURIComponent(id)}`, {
              lastModified: fallbackModified,
              changeFrequency: "weekly",
              priority: 0.6,
            });
          })
          .filter((row): row is SitemapEntry => row !== null)
      : [];

  return [...videoEntries, ...eventEntries, ...creatorEntries];
}

export function buildStaticSitemapStaticEntries(): SitemapEntry[] {
  return [
    entry("/", { changeFrequency: "daily", priority: 1 }),
    entry("/recommend", { changeFrequency: "daily", priority: 0.8 }),
    entry("/list", { changeFrequency: "daily", priority: 0.8 }),
    entry("/event", { changeFrequency: "daily", priority: 0.7 }),
    entry("/user", { changeFrequency: "weekly", priority: 0.6 }),
    entry("/about", { changeFrequency: "monthly", priority: 0.4 }),
    entry("/rules", { changeFrequency: "monthly", priority: 0.3 }),
  ];
}
