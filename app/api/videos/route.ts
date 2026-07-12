export const runtime = "edge";

import { NextResponse } from "next/server";
import {
  countPublicVideos,
  fetchPublicVideos,
  parsePublicVideoSort,
  type ListVideoParams,
} from "@/lib/db/listQueries";
import { getDatabase } from "@/lib/cloudflare";
import {
  MAX_PUBLIC_LIST_LIMIT,
  PUBLIC_VIDEO_KEYS,
  PublicVideoDto,
  assertNoForbiddenKeys,
  pickKeys,
} from "@/lib/api/publicDto";

/** 作品一覧の JSON API。`/list` などの軽量クライアント側ロード用。 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const sort = parsePublicVideoSort(url.searchParams.get("sort"));
  const eventId = url.searchParams.get("event") ?? "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(
    MAX_PUBLIC_LIST_LIMIT,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "24", 10) || 24),
  );

  const db = getDatabase();
  if (!db) {
    return NextResponse.json({ items: [], total: 0, page, limit });
  }

  const params: ListVideoParams = { q, sort, eventId: eventId || undefined };
  const [rows, total] = await Promise.all([
    fetchPublicVideos(db, { ...params, limit, offset: (page - 1) * limit }),
    countPublicVideos(db, params),
  ]);
  // fetchPublicVideos は PUBLIC_VIDEO_KEYS と同列を select 済みだが、
  // ルート層でも明示的に pickKeys を通してホワイトリスト外フィールドを排除する。
  // visibility_status は public でフィルタ済みのため "public" キャストは安全。
  const items: PublicVideoDto[] = rows.map((row) => ({
    ...pickKeys(row, PUBLIC_VIDEO_KEYS),
    status: "public" as const,
  }));
  const payload = { items, total, page, limit };
  assertNoForbiddenKeys(payload);
  return NextResponse.json(
    payload,
    {
      headers: {
        "Cache-Control":
          "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
      },
    },
  );
}
