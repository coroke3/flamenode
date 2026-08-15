
import { getDatabase } from "@/lib/cloudflare";
import { fetchPublicVideoByIdOrYoutube } from "@/lib/db/listQueries";
import {
  PUBLIC_VIDEO_KEYS,
  PublicVideoDto,
  assertNoForbiddenKeys,
  pickKeys,
} from "@/lib/api/publicDto";
import {
  checkPublicApiRateLimit,
  publicJsonResponse,
  publicServiceUnavailableResponse,
} from "@/lib/api/publicApi";

interface Params {
  params: Promise<{ id: string }>;
}

function decodePathSegment(raw: string | undefined): string | null {
  try {
    return decodeURIComponent(raw ?? "").trim();
  } catch {
    return null;
  }
}

/** 公開作品の単体 JSON API。内部 ID は返さず、リスト API と同じ DTO に絞る。 */
export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const limited = checkPublicApiRateLimit(_req, "/api/videos/:id");
  if (limited) return limited;
  const { id } = await params;
  const key = decodePathSegment(id);
  if (!key) {
    return publicJsonResponse(_req, { error: "not_found" }, "no-store", 404);
  }

  let db: ReturnType<typeof getDatabase>;
  try {
    db = getDatabase();
  } catch (error) {
    console.error("[public-videos] runtime bindings unavailable", error);
    return publicServiceUnavailableResponse("database_unavailable");
  }
  if (!db) {
    return publicServiceUnavailableResponse("database_unavailable");
  }

  let row: Awaited<ReturnType<typeof fetchPublicVideoByIdOrYoutube>>;
  try {
    row = await fetchPublicVideoByIdOrYoutube(db, key);
  } catch (error) {
    console.error("[public-videos] detail query failed", error);
    return publicServiceUnavailableResponse("database_unavailable");
  }
  if (!row) {
    return publicJsonResponse(_req, { error: "not_found" }, "no-store", 404);
  }

  const item: PublicVideoDto = {
    ...pickKeys(row, PUBLIC_VIDEO_KEYS),
    status: "public" as const,
  };
  const payload = { item };
  assertNoForbiddenKeys(payload);
  return publicJsonResponse(_req, payload, "public, max-age=30, s-maxage=60, stale-while-revalidate=120");
}
