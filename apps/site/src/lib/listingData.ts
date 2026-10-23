/**
 * Build-time data for `/list`, `/recommend`, `/trending` (MIG-0505). Reads the verified listing snapshots and
 * projects them with CURRENT's pure public-only normalizers (non-public rows are dropped there).
 * No snapshot configured = null (the pages show CURRENT's empty states). A configured but broken
 * snapshot throws: the build fails instead of publishing an empty ranking.
 */
import type { VideoCardData } from "../../../../src/components/video/VideoCard.tsx";
import { normalizePublicVideoCardList } from "../../../../src/lib/publicData/staticVideoCardCore.ts";
import {
  buildRecommendViewModel,
  normalizeStaticRecommend,
  type StaticRecommendViewModel,
} from "../../../../src/lib/publicData/staticRecommendCore.ts";
import {
  normalizeStaticTrending,
  resolveStaticTrendingStaleMeta,
  type StaticTrendingData,
} from "../../../../src/lib/publicData/staticTrendingCore.ts";
import { LIST_FIRST_PAGE_KEY, RECOMMEND_KEY, TRENDING_KEY, loadListingPayload } from "./publicDataLoader.ts";
import { snapshotAccessFromEnv } from "./snapshotEnv.ts";

export class ListingBuildError extends Error {
  readonly code = "LISTING_INVALID";
  constructor(key: string) {
    super(`Listing snapshot ${key} is not in the CURRENT artifact shape`);
    this.name = "ListingBuildError";
  }
}

export type ListFirstPage = Readonly<{ videos: VideoCardData[]; total: number }>;

export type ListingData = Readonly<{
  list: ListFirstPage | null;
  recommend: StaticRecommendViewModel | null;
  trending: (StaticTrendingData & { stale: boolean }) | null;
}>;

export const EMPTY_LISTING: ListingData = { list: null, recommend: null, trending: null };

/** Payload `{ videos: row[], total: number }`; rows are CURRENT static video card rows. */
export function projectListFirstPage(payload: unknown): ListFirstPage {
  const row = payload as { videos?: unknown; total?: unknown } | null;
  const videos = normalizePublicVideoCardList(row?.videos);
  const total = Number(row?.total);
  if (!Number.isSafeInteger(total) || total < videos.length) throw new ListingBuildError(LIST_FIRST_PAGE_KEY);
  return { videos, total };
}

export function projectRecommend(payload: unknown): StaticRecommendViewModel {
  const pools = normalizeStaticRecommend((payload ?? {}) as Parameters<typeof normalizeStaticRecommend>[0]);
  if (!pools) throw new ListingBuildError(RECOMMEND_KEY);
  return buildRecommendViewModel(pools);
}

export function projectTrending(payload: unknown, nowSec: number): ListingData["trending"] {
  const data = normalizeStaticTrending((payload ?? {}) as Parameters<typeof normalizeStaticTrending>[0]);
  if (!data) throw new ListingBuildError(TRENDING_KEY);
  return { ...data, stale: resolveStaticTrendingStaleMeta(data.generatedAt, nowSec).stale };
}

export async function loadListingForBuild(
  env: Record<string, string | undefined> = process.env,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<ListingData> {
  const access = snapshotAccessFromEnv(env);
  if (!access) return EMPTY_LISTING;
  const read = (key: string) => loadListingPayload(access.source, key, access.options);
  return {
    list: projectListFirstPage(await read(LIST_FIRST_PAGE_KEY)),
    recommend: projectRecommend(await read(RECOMMEND_KEY)),
    trending: projectTrending(await read(TRENDING_KEY), nowSec),
  };
}
