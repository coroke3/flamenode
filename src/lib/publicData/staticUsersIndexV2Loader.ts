import "server-only";

import { loadPublicJson, type PublicDataMode } from "./loader";
import { PUBLIC_JSON_CACHE_TTL_SEC } from "./publicJsonCacheTtl";
import {
  loadPublicVisibilityBlockedEntitiesManifest,
  resolvePublicVisibilityGuardModeFromEnv,
} from "./publicVisibilityManifest";
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

async function hasEnforcedXUserVisibilityFence(): Promise<boolean> {
  if (resolvePublicVisibilityGuardModeFromEnv() !== "enforce") return false;
  const manifest = await loadPublicVisibilityBlockedEntitiesManifest();
  return manifest.entities.some((entry) => entry.entity_type === "x_user");
}

/**
 * /user 専用のv2 loader。
 * 検索なしは score / works / name を生成済みpage shardから読み、request-time全件sortを避ける。
 * 検索ありだけcompact search-liteをfilterし、score以外はfilter後の候補だけをsortする。
 *
 * manifest は世代切替の唯一のcommit pointなので Cache API の古い値を正本にしない。
 * R2を必ず先に読み、R2からmanifestが消えた場合はstale cacheへ戻さずlegacyへ倒す。
 * page/searchはgeneration固有keyのため通常のCache APIを安全に利用できる。
 *
 * shard単位のfilterだけでは、別pageにblocked X userがいる場合にmanifest.totalが
 * staleなまま残り得る。enforce中にX user fenceが1件でも存在するときはv2を使わず、
 * 全件にfenceを適用できるlegacy users/index.jsonへ戻す。
 */
export async function loadStaticUsersIndexV2Page(params: {
  page: number;
  sort: UsersIndexV2Sort;
  q?: string;
}): Promise<StaticUsersIndexV2PageResult | null> {
  const requestedPage = safeRequestedPage(params.page);
  const manifestResult = await loadPublicJson<unknown>({
    r2Key: USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
    targetType: "users_index",
    targetId: "global",
    reason: "public_users_index_v2_manifest_miss",
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
    cacheMode: "r2_first",
    allowStaleCacheFallback: false,
  });
  const manifest = normalizeUsersIndexV2Manifest(manifestResult.data);
  if (!manifest || !manifest.sorts.includes(params.sort)) return null;
  if (await hasEnforcedXUserVisibilityFence()) return null;

  const query = params.q?.trim() ?? "";
  if (query) {
    const searchResult = await loadPublicJson<unknown>({
      r2Key: usersIndexV2SearchLiteObjectKey(manifest.generation),
      targetType: "users_index",
      targetId: "global",
      reason: "public_users_search_lite_miss",
      cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
    });
    const search = normalizeUsersSearchLiteV1(searchResult.data);
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
      mode: searchResult.mode,
    };
  }

  const { totalPages, safePage } = pageMetadata(
    manifest.total,
    requestedPage,
    manifest.page_size,
  );
  const pageResult = await loadPublicJson<unknown>({
    r2Key: usersIndexV2PageObjectKey(
      manifest.generation,
      params.sort,
      safePage,
    ),
    targetType: "users_index",
    targetId: "global",
    reason: `public_users_index_v2_${params.sort}_page_miss`,
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
  });
  const page = normalizeUsersIndexV2Page(pageResult.data);
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
    mode: pageResult.mode,
  };
}

/** Backward-compatible score helper for isolated callers/tests. */
export async function loadStaticUsersIndexV2ScorePage(params: {
  page: number;
  q?: string;
}): Promise<StaticUsersIndexV2PageResult | null> {
  return loadStaticUsersIndexV2Page({ ...params, sort: "score" });
}
