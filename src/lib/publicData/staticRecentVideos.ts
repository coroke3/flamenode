import "server-only";
import {
  loadPublicJson,
  type PublicJsonLoadResult,
} from "./loader";
import {
  normalizeStaticRecentVideoPage,
  type StaticRecentVideoPage,
  type StaticRecentVideosPayload,
} from "./staticRecentVideoCore";

const RECENT_VIDEOS_KEY = "list/recent.json";

export async function loadStaticRecentVideosPage(params: {
  page: number;
  pageSize: number;
}): Promise<
  PublicJsonLoadResult<StaticRecentVideoPage> & { page: StaticRecentVideoPage | null }
> {
  const result = await loadPublicJson<StaticRecentVideosPayload>({
    r2Key: RECENT_VIDEOS_KEY,
    targetType: "list_recent",
    targetId: "global",
    reason: "public_list_miss",
  });
  const page = result.data
    ? normalizeStaticRecentVideoPage(result.data, params.page, params.pageSize)
    : null;
  return { ...result, data: page, page };
}
