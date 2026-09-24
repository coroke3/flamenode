
import {
  fetchPublicVideosPage,
  parsePublicVideoSort,
  type ListVideoParams,
} from "@/lib/db/listQueries";
import { withDatabaseRead } from "@/lib/cloudflare";
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

/** 作品一覧のJSON API。`/list`などの軽量クライアント側ロード用。 */
export async function GET(req: Request): Promise<Response> {
  const limited = checkPublicApiRateLimit(req, "/api/videos");
  if (limited) return limited;
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const sort = parsePublicVideoSort(url.searchParams.get("sort"));
  const eventId = url.searchParams.get("event") ?? "";
  const page = parseBoundedPositiveInt(url.searchParams.get("page"), 1);
  const limit = parseBoundedPositiveInt(
    url.searchParams.get("limit"),
    24,
    MAX_PUBLIC_LIST_LIMIT,
  );

  const params: ListVideoParams = {
    q,
    sort,
    eventId: eventId || undefined,
    limit,
    offset: (page - 1) * limit,
  };
  let result: Awaited<ReturnType<typeof fetchPublicVideosPage>> | null;
  try {
    result = await withDatabaseRead((db) =>
      fetchPublicVideosPage(db, params),
    );
  } catch (error) {
    console.error("[public-videos] list query failed", error);
    return publicServiceUnavailableResponse("database_unavailable");
  }
  if (!result) {
    return publicServiceUnavailableResponse("database_unavailable");
  }

  const { items: rows, total } = result;

  // DB側で明示列を絞り込んでいるが、ルート層でもホワイトリストを適用する。
  const items: PublicVideoDto[] = rows.map((row) => ({
    ...pickKeys(row, PUBLIC_VIDEO_KEYS),
    status: "public" as const,
  }));
  const payload = { items, total, page, limit };
  assertNoForbiddenKeys(payload);
  return publicJsonResponse(
    req,
    payload,
    "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
  );
}
