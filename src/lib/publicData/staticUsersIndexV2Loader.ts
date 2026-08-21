import "server-only";

import { loadPublicJson, type PublicDataMode } from "./loader";
import { PUBLIC_JSON_CACHE_TTL_SEC } from "./publicJsonCacheTtl";
import {
  loadPublicVisibilityBlockedEntitiesManifest,
  resolvePublicVisibilityGuardModeFromEnv,
} from "./publicVisibilityManifest";
import {
  filterUsersSearchLiteByQuery,
  normalizeUsersIndexV2Manifest,
  normalizeUsersIndexV2ScorePage,
  normalizeUsersSearchLiteV1,
  USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
  USERS_SEARCH_LITE_V1_OBJECT_KEY,
  usersIndexV2ScorePageObjectKey,
  type UsersIndexV2Entry,
} from "./staticUsersIndexV2Core";

export type StaticUsersIndexV2PageResult = {
  items: UsersIndexV2Entry[];
  total: number;
  totalPages: number;
  safePage: number;
  pageSize: number;
  mode: PublicDataMode;
};

function pageMetadata(total: number, requestedPage: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, requestedPage), totalPages);
  return { totalPages, safePage };
}

async function hasEnforcedXUserVisibilityFence(): Promise<boolean> {
  if (resolvePublicVisibilityGuardModeFromEnv() !== "enforce") return false;
  const manifest = await loadPublicVisibilityBlockedEntitiesManifest();
  return manifest.entities.some((entry) => entry.entity_type === "x_user");
}

/**
 * score route 専用のv2 loader。
 * manifest/page/search の generation が一致する場合だけ採用する。
 *
 * shard単位のfilterだけでは、別pageにblocked X userがいる場合にmanifest.totalが
 * staleなまま残り得る。enforce中にX user fenceが1件でも存在するときはv2を使わず、
 * 全件にfenceを適用できるlegacy users/index.jsonへ戻す。
 */
export async function loadStaticUsersIndexV2ScorePage(params: {
  page: number;
  q?: string;
}): Promise<StaticUsersIndexV2PageResult | null> {
  const requestedPage = Math.max(1, Math.floor(params.page));
  const manifestResult = await loadPublicJson<unknown>({
    r2Key: USERS_INDEX_V2_MANIFEST_OBJECT_KEY,
    targetType: "users_index",
    targetId: "global",
    reason: "public_users_index_v2_manifest_miss",
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
  });
  const manifest = normalizeUsersIndexV2Manifest(manifestResult.data);
  if (!manifest) return null;
  if (await hasEnforcedXUserVisibilityFence()) return null;

  const query = params.q?.trim() ?? "";
  if (query) {
    const searchResult = await loadPublicJson<unknown>({
      r2Key: USERS_SEARCH_LITE_V1_OBJECT_KEY,
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

    const filtered = filterUsersSearchLiteByQuery(search.items, query);
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
    r2Key: usersIndexV2ScorePageObjectKey(safePage),
    targetType: "users_index",
    targetId: "global",
    reason: "public_users_index_v2_page_miss",
    cacheTtlSeconds: PUBLIC_JSON_CACHE_TTL_SEC.usersIndex,
  });
  const page = normalizeUsersIndexV2ScorePage(pageResult.data);
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
