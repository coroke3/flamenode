import "server-only";

import {
  recordPublicFallbackReason,
  notePublicPathMode,
  notePublicSearchBackend,
  recordPublicSearchCandidates,
  recordPublicSearchShard,
} from "@/lib/observability/publicRequestMetrics";
import type { PublicDataMode } from "./publicDataMode";
import { PUBLIC_JSON_CACHE_TTL_SEC } from "./publicJsonCacheTtl";
import {
  loadPublicVisibilityBlockedEntitiesManifest,
  resolvePublicVisibilityGuardModeFromEnv,
} from "./publicVisibilityManifest";
import { loadStaticJsonFreshStaleUnavailable } from "./staticSharedInputsLoader";
import {
  normalizeUsersIndexV2Manifest,
  normalizeUsersIndexV2Page,
  normalizeUsersSearchPostingDirectory,
  normalizeUsersSearchPostingManifest,
  normalizeUsersSearchPostingPage,
  normalizeUsersSearchLiteV1,
  prepareUsersSearchLiteItems,
  usersIndexV2SearchDirectoryObjectKey,
  usersIndexV2SearchManifestObjectKey,
  usersIndexV2SearchPostingPageObjectKey,
  USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
  usersIndexV2PageObjectKey,
  usersIndexV2SearchLiteObjectKey,
  type UsersIndexV2Entry,
  type UsersIndexV2Sort,
} from "./staticUsersIndexV2Core";
import {
  normalizeStaticSearchQuery,
  staticSearchPostingBucket,
  staticSearchQueryGrams,
  STATIC_SEARCH_POSTINGS_MAX_QUERY_PAGES,
  type StaticSearchPostingDirectory,
} from "./staticSearchPostingsCore";

export type StaticUsersIndexV2PageResult = {
  items: UsersIndexV2Entry[];
  total: number;
  totalPages: number;
  safePage: number;
  pageSize: number;
  mode: PublicDataMode;
};

function safeRequestedPage(page: number): number {
  return Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
}

function pageMetadata(total: number, requestedPage: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(safeRequestedPage(requestedPage), totalPages);
  return { totalPages, safePage };
}

function staticModeForStatus(status: "fresh" | "stale"): PublicDataMode {
  return status === "stale" ? "cached_static" : "static";
}

async function loadUsersPostingSearch(params: {
  generation: string;
  manifestTotal: number;
  pageSize: number;
  requestedPage: number;
  sort: UsersIndexV2Sort;
  query: string;
}): Promise<StaticUsersIndexV2PageResult | null> {
  const postingManifestResult = await loadStaticJsonFreshStaleUnavailable({
    key: usersIndexV2SearchManifestObjectKey(params.generation),
    normalize: normalizeUsersSearchPostingManifest,
    maxStaleAgeSec: 24 * 60 * 60,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
  });
  const postingManifest = postingManifestResult.value;
  if (
    !postingManifest ||
    postingManifest.generation !== `users-${params.generation}` ||
    postingManifest.total !== params.manifestTotal
  ) {
    recordPublicFallbackReason("users_postings_manifest_miss");
    return null;
  }
  notePublicSearchBackend("postings-v1");

  const query = normalizeStaticSearchQuery(params.query);
  const grams = staticSearchQueryGrams(query);
  if (grams.length === 0) return null;

  const directories = new Map<number, StaticSearchPostingDirectory>();
  const candidates: Array<{ gram: string; total: number; pages: number[] }> = [];
  let stale = postingManifestResult.status === "stale";
  for (const gram of grams) {
    const bucket = staticSearchPostingBucket(gram);
    // New manifests list only non-empty buckets. A missing directory in that
    // layout is a valid zero-candidate result; older manifests omit the list
    // and therefore retain the conservative miss/fallback behavior.
    if (postingManifest.buckets && !postingManifest.buckets.includes(bucket)) {
      continue;
    }
    let directory = directories.get(bucket);
    if (!directory) {
      const result = await loadStaticJsonFreshStaleUnavailable({
        key: usersIndexV2SearchDirectoryObjectKey(params.generation, bucket),
        normalize: normalizeUsersSearchPostingDirectory,
        maxStaleAgeSec: 24 * 60 * 60,
        cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
      });
      if (!result.value || result.value.bucket !== bucket) {
        recordPublicFallbackReason("users_postings_directory_miss");
        return null;
      }
      if (result.value.generation !== `users-${params.generation}`) {
        recordPublicFallbackReason("users_postings_generation_mismatch");
        return null;
      }
      directory = result.value;
      directories.set(bucket, directory);
      recordPublicSearchShard();
      stale ||= result.status === "stale";
    }
    const entry = directory.grams[gram];
    if (entry) candidates.push({ gram, ...entry });
  }

  if (candidates.length === 0) {
    return {
      items: [],
      total: 0,
      totalPages: 1,
      safePage: 1,
      pageSize: params.pageSize,
      mode: staticModeForStatus(stale ? "stale" : "fresh"),
    };
  }
  candidates.sort((a, b) => a.total - b.total || a.gram.localeCompare(b.gram));
  const selected = candidates[0];
  // A common one-character gram can legitimately have many posting pages.
  // Do not spend an unbounded number of R2 subrequests on one public request;
  // the caller will use the existing safe compatibility/degraded path.
  if (selected.pages.length > STATIC_SEARCH_POSTINGS_MAX_QUERY_PAGES) {
    recordPublicFallbackReason("users_postings_page_budget");
    return null;
  }
  const items = new Map<string, UsersIndexV2Entry>();
  for (const pageNumber of selected.pages) {
    const bucket = staticSearchPostingBucket(selected.gram);
    const result = await loadStaticJsonFreshStaleUnavailable({
      key: usersIndexV2SearchPostingPageObjectKey(
        params.generation,
        bucket,
        pageNumber,
      ),
      normalize: normalizeUsersSearchPostingPage,
      maxStaleAgeSec: 24 * 60 * 60,
      cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
    });
    if (
      !result.value ||
      result.value.generation !== `users-${params.generation}` ||
      result.value.bucket !== bucket ||
      result.value.page !== pageNumber
    ) {
      recordPublicFallbackReason("users_postings_page_miss");
      return null;
    }
    recordPublicSearchShard();
    stale ||= result.status === "stale";
    for (const record of result.value.records) {
      if (record.gram !== selected.gram) continue;
      for (const item of record.items) items.set(item.x_id, item);
    }
  }
  if (items.size !== selected.total) {
    recordPublicFallbackReason("users_postings_candidate_mismatch");
    return null;
  }
  recordPublicSearchCandidates(items.size);
  const filtered = prepareUsersSearchLiteItems([...items.values()], query, params.sort);
  const { totalPages, safePage } = pageMetadata(filtered.length, params.requestedPage, params.pageSize);
  const start = (safePage - 1) * params.pageSize;
  return {
    items: filtered.slice(start, start + params.pageSize),
    total: filtered.length,
    totalPages,
    safePage,
    pageSize: params.pageSize,
    mode: staticModeForStatus(stale ? "stale" : "fresh"),
  };
}

async function shouldFallbackForVisibilityFence(): Promise<boolean> {
  if (resolvePublicVisibilityGuardModeFromEnv() !== "enforce") return false;
  try {
    const manifest = await loadPublicVisibilityBlockedEntitiesManifest();
    return manifest.entities.some((entry) => entry.entity_type === "x_user");
  } catch (error) {
    // v2縺ｯ莉ｻ諢城ｫ倬溷喧謌先棡迚ｩ縲Ｗisibility manifest髫懷ｮｳ譎ゅ↓v2繧定ｿ斐☆縺ｨfail-open縺ｫ縺ｪ繧九◆繧√・
    // legacy loader縺ｸ謌ｻ縺励※譌｢蟄倥・fail-closed unavailable蛻､螳壹∈蟋斐・繧九・
    console.warn(
      JSON.stringify({
        service: "users-index-v2",
        result: "visibility_fence_fallback",
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return true;
  }
}

/**
 * /user 蟆ら畑縺ｮ莉ｻ諢竣2 loader縲・
 * v2谺謳肴凾縺ｯD1 probe/degraded fallback/rebuild enqueue縺ｸ騾ｲ縺ｾ縺壹∝叉legacy縺ｸ謌ｻ縺吶・
 * manifest縺ｯ蜚ｯ荳縺ｮcommit point縺ｪ縺ｮ縺ｧCache API繧剃ｽｿ繧上★R2繧堤峩謗･豁｣譛ｬ縺ｨ縺励※隱ｭ繧縲・
 * generation蝗ｺ譛英age/search縺ｯimmutable縺ｪ縺ｮ縺ｧCache API縺ｮbounded stale fallback繧定ｨｱ蜿ｯ縺吶ｋ縲・
 */
export async function loadStaticUsersIndexV2Page(params: {
  page: number;
  sort: UsersIndexV2Sort;
  q?: string;
}): Promise<StaticUsersIndexV2PageResult | null> {
  const requestedPage = safeRequestedPage(params.page);
  const manifestResult = await loadStaticJsonFreshStaleUnavailable({
    key: USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
    normalize: normalizeUsersIndexV2Manifest,
    maxStaleAgeSec: 0,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
    cacheMode: "bypass",
  });
  const manifest = manifestResult.value;
  if (!manifest || !manifest.sorts.includes(params.sort)) return null;
  notePublicPathMode("v2");

  // shard蜊倅ｽ阪〒縺ｯ蛻･page縺ｮblocked X user繧稚otal縺九ｉ髯､螟悶〒縺阪↑縺・◆繧√・
  // enforce荳ｭ縺ｫX user fence縺後≠繧九√∪縺溘・manifest繧貞ｮ牙・縺ｫ隱ｭ繧√↑縺・ｴ蜷医・legacy縺ｸ謌ｻ縺吶・
  if (await shouldFallbackForVisibilityFence()) return null;

  const query = params.q?.trim() ?? "";
  if (query) {
    if (manifest.search_backend === "postings-v1") {
      const postingResult = await loadUsersPostingSearch({
        generation: manifest.generation,
        manifestTotal: manifest.total,
        pageSize: manifest.page_size,
        requestedPage,
        sort: params.sort,
        query,
      });
      if (postingResult) return postingResult;
      // A missing/corrupt posting shard is not a reason to expose an unsafe
      // partial result. Fall through to the immutable legacy search artifact
      // only when it is available for this generation.
    }
    notePublicSearchBackend("legacy");
    recordPublicFallbackReason("users_postings_compatibility");
    const searchResult = await loadStaticJsonFreshStaleUnavailable({
      key: usersIndexV2SearchLiteObjectKey(manifest.generation),
      normalize: normalizeUsersSearchLiteV1,
      maxStaleAgeSec: 24 * 60 * 60,
      cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
    });
    const search = searchResult.value;
    if (
      !search ||
      search.generation !== manifest.generation ||
      search.total !== manifest.total
    ) {
      return null;
    }

    const filtered = prepareUsersSearchLiteItems(
      search.items,
      query,
      params.sort,
    );
    const { totalPages, safePage } = pageMetadata(
      filtered.length,
      requestedPage,
      manifest.page_size,
    );
    const start = (safePage - 1) * manifest.page_size;
    return {
      items: filtered.slice(start, start + manifest.page_size),
      total: filtered.length,
      totalPages,
      safePage,
      pageSize: manifest.page_size,
      mode: staticModeForStatus(
        searchResult.status === "stale" ? "stale" : "fresh",
      ),
    };
  }

  const { totalPages, safePage } = pageMetadata(
    manifest.total,
    requestedPage,
    manifest.page_size,
  );
  const pageResult = await loadStaticJsonFreshStaleUnavailable({
    key: usersIndexV2PageObjectKey(
      manifest.generation,
      params.sort,
      safePage,
    ),
    normalize: normalizeUsersIndexV2Page,
    maxStaleAgeSec: 24 * 60 * 60,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
  });
  const page = pageResult.value;
  const expectedItems = Math.max(
    0,
    Math.min(
      manifest.page_size,
      manifest.total - (safePage - 1) * manifest.page_size,
    ),
  );
  if (
    !page ||
    page.generation !== manifest.generation ||
    page.sort !== params.sort ||
    page.page !== safePage ||
    page.page_size !== manifest.page_size ||
    page.total !== manifest.total ||
    page.items.length !== expectedItems
  ) {
    return null;
  }

  return {
    items: page.items,
    total: manifest.total,
    totalPages,
    safePage,
    pageSize: manifest.page_size,
    mode: staticModeForStatus(
      pageResult.status === "stale" ? "stale" : "fresh",
    ),
  };
}

export async function loadStaticUsersIndexV2ScorePage(params: {
  page: number;
  q?: string;
}): Promise<StaticUsersIndexV2PageResult | null> {
  return loadStaticUsersIndexV2Page({ ...params, sort: "score" });
}
