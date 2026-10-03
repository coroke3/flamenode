import { parsePublicVideoSort } from "@/lib/db/listQueries";
import {
  loadPublicEventVideosPage,
  loadStaticPopularVideosPage,
  loadStaticRecentVideosPage,
  loadStaticSearchVideosPage,
  type StaticRecentVideoPage,
} from "@/lib/publicData/loader";
import {
  MAX_PUBLIC_LIST_LIMIT,
  PUBLIC_VIDEO_KEYS,
  PublicVideoDto,
  assertNoForbiddenKeys,
  pickKeys,
} from "@/lib/api/publicDto";
import {
  checkPublicApiRateLimit,
  parseBoundedPositiveInt,
  publicJsonResponse,
  publicServiceUnavailableResponse,
} from "@/lib/api/publicApi";

const MAX_SEARCH_LENGTH = 100;
const MAX_EVENT_ID_LENGTH = 128;
const MIN_SEARCH_CHARS = 2;
// 静的一覧投影は最大5,000件。これを超えるpageは同じ範囲へ丸め、
// 任意のpage値が巨大なR2/D1走査を起こさないようにする。
const MAX_PROJECTED_ITEMS = 5_000;
const LIST_CACHE_CONTROL =
  "public, max-age=30, s-maxage=60, stale-while-revalidate=120";

function compactSearchChars(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}_]/gu, "");
}

/**
 * 作品一覧のJSON API。D1を直接読まず、`/list`と同じR2静的投影ローダーだけを使う。
 * 投影が未生成・再構築中のときは空配列200ではなく503を返す。
 */
export async function GET(req: Request): Promise<Response> {
  const limited = checkPublicApiRateLimit(req, "/api/videos");
  if (limited) return limited;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_SEARCH_LENGTH);
  const sort = parsePublicVideoSort(url.searchParams.get("sort")?.slice(0, 16));
  const eventId = (url.searchParams.get("event") ?? "")
    .trim()
    .slice(0, MAX_EVENT_ID_LENGTH);
  const limit = parseBoundedPositiveInt(
    url.searchParams.get("limit"),
    24,
    MAX_PUBLIC_LIST_LIMIT,
  );
  const page = parseBoundedPositiveInt(
    url.searchParams.get("page"),
    1,
    Math.ceil(MAX_PROJECTED_ITEMS / limit),
  );

  const searchTooShort =
    q.length > 0 && compactSearchChars(q).length < MIN_SEARCH_CHARS;

  let listPage: StaticRecentVideoPage | null;
  if (searchTooShort) {
    // /list と同じく、短すぎる検索語は投影を読まずに0件として扱う。
    listPage = { videos: [], total: 0, generatedAt: null };
  } else {
    try {
      if (eventId) {
        listPage = (
          await loadPublicEventVideosPage({
            eventId,
            sort,
            page,
            pageSize: limit,
            q,
          })
        ).page;
      } else if (q) {
        listPage = (
          await loadStaticSearchVideosPage({
            q,
            sort,
            page,
            pageSize: limit,
          })
        ).page;
      } else if (sort === "score") {
        listPage = (await loadStaticPopularVideosPage({ page, pageSize: limit }))
          .page;
      } else {
        listPage = (
          await loadStaticRecentVideosPage({ page, pageSize: limit, sort })
        ).page;
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
    ...pickKeys(row, PUBLIC_VIDEO_KEYS),
    status: "public" as const,
  }));
  const payload = { items, total: listPage.total, page, limit };
  assertNoForbiddenKeys(payload);
  return publicJsonResponse(req, payload, LIST_CACHE_CONTROL);
}
