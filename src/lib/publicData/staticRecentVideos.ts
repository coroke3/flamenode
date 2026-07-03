import "server-only";
import { readStaticJsonIfStaticOnly } from "./staticJson";
import {
  normalizeStaticRecentVideoPage,
  type StaticRecentVideoPage,
  type StaticRecentVideosPayload,
} from "./staticRecentVideoCore";

const RECENT_VIDEOS_KEY = "list/recent.json";

export async function loadStaticRecentVideosPage(params: {
  page: number;
  pageSize: number;
}): Promise<StaticRecentVideoPage | null> {
  const payload =
    await readStaticJsonIfStaticOnly<StaticRecentVideosPayload>(RECENT_VIDEOS_KEY);
  if (!payload) return null;
  return normalizeStaticRecentVideoPage(payload, params.page, params.pageSize);
}
