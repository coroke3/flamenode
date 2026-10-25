import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { loadPublicSnapshot } from "../../lib/publicSnapshot.ts";
import { resolvePublicOperationMode } from "../live/operationMode.ts";
import {
  checkPublicApiRateLimit,
  parseBoundedPositiveInt,
  parsePublicVideoSort,
  publicJsonResponse,
  publicServiceUnavailableResponse,
} from "@flamenode/server-core/publicData/publicApi";
import {
  MAX_PUBLIC_LIST_LIMIT,
  PUBLIC_VIDEO_KEYS,
  type PublicVideoDto,
  assertNoForbiddenKeys,
  pickKeys,
} from "@flamenode/server-core/publicData/publicDto";
import { getPublicDataStrategy, type PublicDataStrategy } from "@flamenode/domain/admin";
import { shouldUseStaticCollection } from "@flamenode/server-core/publicData/loaderPolicy";
import {
  normalizeStaticRecentVideoPage,
  type StaticRecentVideoPage,
  type StaticRecentVideosPayload,
} from "@flamenode/server-core/publicData/recentVideoCore";
import { normalizeStaticPopularVideoPage } from "@flamenode/server-core/publicData/popularVideoCore";
import {
  STATIC_SEARCH_POSTINGS_MAX_QUERY_PAGES,
  staticSearchPostingBucket,
  staticSearchQueryGrams,
  type StaticSearchPostingDirectory,
} from "@flamenode/server-core/publicData/searchPostingsCore";
import {
  normalizeStaticVideoSearchPostingManifest,
  normalizeStaticVideoSearchPostingDirectory,
  normalizeStaticVideoSearchPostingPage,
  staticVideoSearchPostingManifestObjectKey,
  staticVideoSearchPostingDirectoryObjectKey,
  staticVideoSearchPostingPageObjectKey,
  staticSearchVideoMatchesNormalizedQuery,
  toListVideo,
  searchStaticIndexVideos,
  normalizeStaticSearchIndexPayload,
  type StaticSearchIndexVideo,
} from "@flamenode/server-core/publicData/searchIndexCore";
import {
  isCompleteEventBasePool,
  eventListPayloadSupportsSort,
  extractEventListInfo,
  pageEventBaseVideos,
} from "@flamenode/server-core/publicData/eventListCore";
import type { StaticEventDetailPayload } from "@flamenode/server-core/publicData/eventDetailCore";

const MAX_SEARCH_LENGTH = 100;
const MAX_EVENT_ID_LENGTH = 128;
const MIN_SEARCH_CHARS = 2;
const MAX_PROJECTED_ITEMS = 5_000;
const LIST_CACHE_CONTROL =
  "public, max-age=30, s-maxage=60, stale-while-revalidate=120";

function compactSearchChars(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}_]/gu, "");
}

function sortRecentPayloadForList(
  payload: StaticRecentVideosPayload,
  sort: "new" | "old" | "score",
): StaticRecentVideosPayload {
  if (sort !== "old" || !Array.isArray(payload.items)) {
    return payload;
  }
  const items = [...payload.items].sort((left, right) => {
    const leftRow = left as { scheduled_time?: unknown };
    const rightRow = right as { scheduled_time?: unknown };
    const leftTime = Number(leftRow.scheduled_time ?? 0);
    const rightTime = Number(rightRow.scheduled_time ?? 0);
    return leftTime - rightTime;
  });
  return { ...payload, items };
}

async function loadEventVideos(
  bucket: R2Bucket | undefined,
  guardModeRaw: string | undefined,
  eventId: string,
  sort: "new" | "old" | "score",
  page: number,
  limit: number,
  q?: string,
): Promise<StaticRecentVideoPage | null> {
  let snapshot = await loadPublicSnapshot({
    bucket,
    key: `events/${eventId}/base.v1.json`,
    targetType: "event_base",
    guardModeRaw,
    targetEntityId: eventId,
  });

  if (snapshot.kind !== "ok") {
    snapshot = await loadPublicSnapshot({
      bucket,
      key: `events/${eventId}.json`,
      targetType: "event",
      guardModeRaw,
      targetEntityId: eventId,
    });
  }

  if (snapshot.kind !== "ok" || !snapshot.data) return null;
  const payload = snapshot.data as StaticEventDetailPayload;
  if (!isCompleteEventBasePool(payload)) return null;
  if (!eventListPayloadSupportsSort(payload, sort)) return null;
  const eventInfo = extractEventListInfo(payload);
  if (!eventInfo) return null;
  return pageEventBaseVideos({
    payload,
    sort,
    page,
    pageSize: limit,
    q,
    eventTitle: eventInfo.title,
  });
}

async function loadSearchVideos(
  bucket: R2Bucket | undefined,
  guardModeRaw: string | undefined,
  strategy: PublicDataStrategy,
  q: string,
  sort: "new" | "old" | "score",
  page: number,
  limit: number,
): Promise<StaticRecentVideoPage | null> {
  const manifestSnapshot = await loadPublicSnapshot({
    bucket,
    key: staticVideoSearchPostingManifestObjectKey("current"),
    targetType: "search_index",
    guardModeRaw,
  });

  const manifest =
    manifestSnapshot.kind === "ok" && manifestSnapshot.data
      ? normalizeStaticVideoSearchPostingManifest(manifestSnapshot.data)
      : null;

  const query = q.trim().toLowerCase();
  const grams = staticSearchQueryGrams(query);
  // CURRENT loadStaticVideoPostingPage: no gram falls through to search-index-lite.json.
  if (manifest && manifest.generation.startsWith("videos-") && grams.length > 0) {

    const directories = new Map<number, StaticSearchPostingDirectory>();
    const options: Array<{ gram: string; total: number; pages: number[] }> = [];
    let directoryMiss = false;

    for (const gram of grams) {
      const bucketId = staticSearchPostingBucket(gram);
      if (manifest.buckets && !manifest.buckets.includes(bucketId)) continue;
      let directory = directories.get(bucketId);
      if (!directory) {
        const dirSnapshot = await loadPublicSnapshot({
          bucket,
          key: staticVideoSearchPostingDirectoryObjectKey(
            manifest.generation.slice("videos-".length),
            bucketId,
          ),
          targetType: "search_index",
          guardModeRaw,
        });
        const normalizedDir =
          dirSnapshot.kind === "ok" && dirSnapshot.data
            ? normalizeStaticVideoSearchPostingDirectory(dirSnapshot.data)
            : null;
        if (
          !normalizedDir ||
          normalizedDir.generation !== manifest.generation ||
          normalizedDir.bucket !== bucketId
        ) {
          directoryMiss = true;
          break;
        }
        directory = normalizedDir;
        directories.set(bucketId, normalizedDir);
      }
      const entry = directory.grams[gram];
      if (entry) options.push({ gram, ...entry });
    }

    if (!directoryMiss) {
      if (options.length === 0) {
        return { videos: [], total: 0, generatedAt: manifest.generated_at };
      }
      options.sort((a, b) => a.total - b.total || a.gram.localeCompare(b.gram));
      const selected = options[0]!;
      if (selected.pages.length <= STATIC_SEARCH_POSTINGS_MAX_QUERY_PAGES) {
        const candidates = new Map<string, StaticSearchIndexVideo>();
        const generation = manifest.generation.slice("videos-".length);
        let pageMiss = false;
        for (const pageNumber of selected.pages) {
          const pageSnapshot = await loadPublicSnapshot({
            bucket,
            key: staticVideoSearchPostingPageObjectKey(
              generation,
              staticSearchPostingBucket(selected.gram),
              pageNumber,
            ),
            targetType: "search_index",
            guardModeRaw,
          });
          const postingPage =
            pageSnapshot.kind === "ok" && pageSnapshot.data
              ? normalizeStaticVideoSearchPostingPage(pageSnapshot.data)
              : null;
          if (
            !postingPage ||
            postingPage.generation !== manifest.generation ||
            postingPage.bucket !== staticSearchPostingBucket(selected.gram) ||
            postingPage.page !== pageNumber
          ) {
            pageMiss = true;
            break;
          }
          for (const record of postingPage.records) {
            if (record.gram !== selected.gram) continue;
            for (const item of record.items) candidates.set(item.id, item);
          }
        }

        if (!pageMiss && candidates.size === selected.total) {
          const filtered = [...candidates.values()].filter((v) =>
            staticSearchVideoMatchesNormalizedQuery(v, query),
          );
          const ordered = sort === "old" ? [...filtered].reverse() : filtered;
          const total = ordered.length;
          const totalPages = Math.max(1, Math.ceil(total / limit));
          const safePage = Math.min(Math.max(1, Math.floor(page)), totalPages);
          const start = (safePage - 1) * limit;
          return {
            videos: ordered.slice(start, start + limit).map(toListVideo),
            total,
            generatedAt: manifest.generated_at,
          };
        }
      }
    }
  }

  // Fallback to search-index-lite.json
  const liteSnapshot = await loadPublicSnapshot({
    bucket,
    key: "search-index-lite.json",
    targetType: "search_index",
    guardModeRaw,
  });
  if (liteSnapshot.kind !== "ok" || !liteSnapshot.data) return null;
  const payload = normalizeStaticSearchIndexPayload(liteSnapshot.data as any);
  if (!payload) return null;
  const poolSize = Array.isArray(payload.videos) ? payload.videos.length : 0;
  if (!shouldUseStaticCollection(strategy, poolSize)) return null;
  return searchStaticIndexVideos({
    payload,
    q,
    sort,
    page,
    pageSize: limit,
  });
}

async function loadPopularVideos(
  bucket: R2Bucket | undefined,
  guardModeRaw: string | undefined,
  strategy: PublicDataStrategy,
  page: number,
  limit: number,
): Promise<StaticRecentVideoPage | null> {
  const snapshot = await loadPublicSnapshot({
    bucket,
    key: "list/popular.json",
    targetType: "list_popular",
    guardModeRaw,
  });
  if (snapshot.kind !== "ok" || !snapshot.data) return null;
  const poolSize = Array.isArray((snapshot.data as any).items)
    ? (snapshot.data as any).items.length
    : 0;
  if (!shouldUseStaticCollection(strategy, poolSize)) return null;
  return normalizeStaticPopularVideoPage(snapshot.data as any, page, limit);
}

async function loadRecentVideos(
  bucket: R2Bucket | undefined,
  guardModeRaw: string | undefined,
  strategy: PublicDataStrategy,
  sort: "new" | "old" | "score",
  page: number,
  limit: number,
): Promise<StaticRecentVideoPage | null> {
  const snapshot = await loadPublicSnapshot({
    bucket,
    key: "list/recent.json",
    targetType: "list_recent",
    guardModeRaw,
  });
  if (snapshot.kind !== "ok" || !snapshot.data) return null;
  const payload = snapshot.data as StaticRecentVideosPayload;
  const poolSize = Array.isArray(payload.items) ? payload.items.length : 0;
  if (!shouldUseStaticCollection(strategy, poolSize)) return null;
  const payloadForNormalize =
    sort === "old" ? sortRecentPayloadForList(payload, sort) : payload;
  return normalizeStaticRecentVideoPage(payloadForNormalize, page, limit);
}

export const videoListRoutes = new Hono<AppEnv>();

videoListRoutes.get("/", async (c) => {
  const limited = checkPublicApiRateLimit(c.req.raw, "/api/videos");
  if (limited) return limited;

  const mode = await resolvePublicOperationMode(c.env, { allowD1: false });
  const strategy = getPublicDataStrategy(mode);
  if (strategy === "maintenance") {
    return publicServiceUnavailableResponse("static_list_unavailable");
  }

  const q = (c.req.query("q") ?? "").trim().slice(0, MAX_SEARCH_LENGTH);
  const sort = parsePublicVideoSort(c.req.query("sort")?.slice(0, 16));
  const eventId = (c.req.query("event") ?? "").trim().slice(0, MAX_EVENT_ID_LENGTH);
  const limit = parseBoundedPositiveInt(
    c.req.query("limit"),
    24,
    MAX_PUBLIC_LIST_LIMIT,
  );
  const page = parseBoundedPositiveInt(
    c.req.query("page"),
    1,
    Math.ceil(MAX_PROJECTED_ITEMS / limit),
  );

  const searchTooShort =
    q.length > 0 && compactSearchChars(q).length < MIN_SEARCH_CHARS;

  let listPage: StaticRecentVideoPage | null;
  if (searchTooShort) {
    listPage = { videos: [], total: 0, generatedAt: null };
  } else {
    try {
      if (eventId) {
        listPage = await loadEventVideos(
          c.env.BUCKET,
          c.env.PUBLIC_VISIBILITY_GUARD_MODE,
          eventId,
          sort,
          page,
          limit,
          q,
        );
      } else if (q) {
        listPage = await loadSearchVideos(
          c.env.BUCKET,
          c.env.PUBLIC_VISIBILITY_GUARD_MODE,
          strategy,
          q,
          sort,
          page,
          limit,
        );
      } else if (sort === "score") {
        listPage = await loadPopularVideos(
          c.env.BUCKET,
          c.env.PUBLIC_VISIBILITY_GUARD_MODE,
          strategy,
          page,
          limit,
        );
      } else {
        listPage = await loadRecentVideos(
          c.env.BUCKET,
          c.env.PUBLIC_VISIBILITY_GUARD_MODE,
          strategy,
          sort,
          page,
          limit,
        );
      }
    } catch (error) {
      console.error("[public-videos] static list load failed", error);
      return publicServiceUnavailableResponse("database_unavailable");
    }
  }

  if (!listPage) {
    return publicServiceUnavailableResponse("static_list_unavailable");
  }

  const items: PublicVideoDto[] = listPage.videos.map((row) => ({
    ...(pickKeys(row as any, PUBLIC_VIDEO_KEYS) as any),
    status: "public" as const,
  }));
  const payload = { items, total: listPage.total, page, limit };
  assertNoForbiddenKeys(payload);
  return publicJsonResponse(c.req.raw, payload, LIST_CACHE_CONTROL);
});
