import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/cloudflare";
import { fetchPublicVideoByIdOrYoutube } from "@/lib/db/listQueries";
import {
  PUBLIC_VIDEO_KEYS,
  PublicVideoDto,
  pickKeys,
} from "@/lib/api/publicDto";

interface Params {
  params: Promise<{ id: string }>;
}

/** 公開作品の単体 JSON API。内部 ID は返さず、リスト API と同じ DTO に絞る。 */
export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const key = decodeURIComponent(id ?? "").trim();
  if (!key) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const db = getDatabase();
  if (!db) {
    return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  }

  const row = await fetchPublicVideoByIdOrYoutube(db, key);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const item: PublicVideoDto = {
    ...pickKeys(row, PUBLIC_VIDEO_KEYS),
    status: "public" as const,
  };
  return NextResponse.json(
    { item },
    {
      headers: {
        "Cache-Control":
          "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
      },
    },
  );
}
