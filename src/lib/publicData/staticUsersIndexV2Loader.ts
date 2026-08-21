import "server-only";

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
  normalizeUsersSearchLiteV1,
  prepareUsersSearchLiteItems,
  USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
  usersIndexV2PageObjectKey,
  usersIndexV2SearchLiteObjectKey,
  type UsersIndexV2Entry,
  type UsersIndexV2Sort,
} from "./staticUsersIndexV2Core";

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

async function shouldFallbackForVisibilityFence(): Promise<boolean> {
  if (resolvePublicVisibilityGuardModeFromEnv() !== "enforce") return false;
  try {
    const manifest = await loadPublicVisibilityBlockedEntitiesManifest();
    return manifest.entities.some((entry) => entry.entity_type === "x_user");
  } catch (error) {
    // v2は任意高速化成果物。visibility manifest障害時にv2を返すとfail-openになるため、
    // legacy loaderへ戻して既存のfail-closed unavailable判定へ委ねる。
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
 * /user 専用の任意v2 loader。
 * v2欠損時はD1 probe/degraded fallback/rebuild enqueueへ進まず、即legacyへ戻す。
 * manifestは唯一のcommit pointなのでCache APIを使わずR2を直接正本として読む。
 * generation固有page/searchはimmutableなのでCache APIのbounded stale fallbackを許可する。
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

  // shard単位では別pageのblocked X userをtotalから除外できないため、
  // enforce中にX user fenceがある、またはmanifestを安全に読めない場合はlegacyへ戻す。
  if (await shouldFallbackForVisibilityFence()) return null;

  const query = params.q?.trim() ?? "";
  if (query) {
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
