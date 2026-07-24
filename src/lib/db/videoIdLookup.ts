import { and, eq, type SQL } from "drizzle-orm";
import { isConfirmedInternalVideoId } from "@/lib/video/internalId";
import type { DB } from "./client";
import { videos } from "./schema";

export { isConfirmedInternalVideoId } from "@/lib/video/internalId";

export type VideoIdLookupOptions = {
  /** 呼び出し元が内部 primary key を保証する場合は true。 */
  internalIdOnly?: boolean;
  andWhere?: SQL;
};

/**
 * 動画 ID 解決: primary key を先に参照し、miss 時のみ youtube_video_id を参照する。
 * OR 結合を避け、各 index を単独で使う。
 */
export async function resolveVideoPrimaryKey(
  db: DB,
  rawId: string,
  options?: VideoIdLookupOptions,
): Promise<string | null> {
  const normalized = rawId.trim();
  if (!normalized) return null;

  const pkWhere = options?.andWhere
    ? and(eq(videos.id, normalized), options.andWhere)!
    : eq(videos.id, normalized);

  const byPk = await db
    .select({ id: videos.id })
    .from(videos)
    .where(pkWhere)
    .limit(1);
  if (byPk[0]?.id) return byPk[0].id;

  if (options?.internalIdOnly || isConfirmedInternalVideoId(normalized)) {
    return null;
  }

  const youtubeWhere = options?.andWhere
    ? and(eq(videos.youtube_video_id, normalized), options.andWhere)!
    : eq(videos.youtube_video_id, normalized);

  const byYoutube = await db
    .select({ id: videos.id })
    .from(videos)
    .where(youtubeWhere)
    .limit(1);
  return byYoutube[0]?.id ?? null;
}

export async function fetchVideoRowByIdOrYoutube(
  db: DB,
  rawId: string,
  options?: VideoIdLookupOptions,
): Promise<typeof videos.$inferSelect | null> {
  const resolvedId = await resolveVideoPrimaryKey(db, rawId, options);
  if (!resolvedId) return null;

  const where = options?.andWhere
    ? and(eq(videos.id, resolvedId), options.andWhere)!
    : eq(videos.id, resolvedId);

  const rows = await db.select().from(videos).where(where).limit(1);
  return rows[0] ?? null;
}
