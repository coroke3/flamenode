import { NextResponse } from "next/server";
import {
  countPublicVideos,
  fetchPublicVideos,
} from "@/lib/db/listQueries";
import { getDatabase } from "@/lib/cloudflare";

/** 作品一覧の JSON API。`/list` などの軽量クライアント側ロード用。 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const sort = url.searchParams.get("sort") ?? "new";
  const eventId = url.searchParams.get("event") ?? "";
  const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const limit = Math.min(48, parseInt(url.searchParams.get("limit") ?? "24", 10) || 24);

  const db = getDatabase();
  if (!db) {
    return NextResponse.json({ items: [], total: 0, page, limit });
  }

  const params = { q, sort: sort as "new" | "old" | "score", eventId: eventId || undefined };
  const [items, total] = await Promise.all([
    fetchPublicVideos(db, { ...params, limit, offset: (page - 1) * limit }),
    countPublicVideos(db, params),
  ]);
  return NextResponse.json({ items, total, page, limit });
}
