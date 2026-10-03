import { and, eq } from "drizzle-orm";
import { events, videos } from "./schema";
import { creatorIconExpr, creatorNameExpr } from "./displayExpr";
import type { DB } from "./client";
import { resolveVideoPrimaryKey } from "./videoIdLookup";

/** 公開作品 API / 一覧ページ用の sort 正規化（未知値は new）。 */
export function parsePublicVideoSort(
  value: string | null | undefined,
): "new" | "old" | "score" {
  if (value === "old" || value === "score") return value;
  return "new";
}

const publicVideoListSelect = {
  id: videos.id,
  title: videos.title,
  youtube_video_id: videos.youtube_video_id,
  display_name: creatorNameExpr,
  icon_url: creatorIconExpr,
  creator_x_user_id: videos.creator_x_user_id,
  primary_event_id: videos.primary_event_id,
  primary_event_title: events.title,
  scheduled_time: videos.scheduled_time,
  status: videos.visibility_status,
  part: videos.part,
} as const;

/** 公開作品の単体取得。UUID / YouTube ID のどちらでも解決する。 */
export async function fetchPublicVideoByIdOrYoutube(
  db: DB,
  idOrYoutube: string,
) {
  const resolvedId = await resolveVideoPrimaryKey(db, idOrYoutube, {
    andWhere: eq(videos.visibility_status, "public"),
  });
  if (!resolvedId) return null;

  const rows = await db
    .select(publicVideoListSelect)
    .from(videos)
    .leftJoin(events, eq(events.id, videos.primary_event_id))
    .where(
      and(
        eq(videos.visibility_status, "public"),
        eq(videos.id, resolvedId),
      )!,
    )
    .limit(1);
  return rows[0] ?? null;
}
