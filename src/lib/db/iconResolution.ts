import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { videos } from "./schema";
import type { DB } from "./client";

/**
 * 旧サイト互換のアイコン解決ヘルパー。
 *
 * 各行に `creator_id` と `icon_url` (NULL 可) が入っている前提で、
 * `icon_url` が NULL の行を「同 creator_id の過去作品」から補う。
 *
 * 優先順位:
 *   1. 入力された icon_url がそのまま入っている (=video の icon_url)
 *   2. 同 creator_id の `individual` 作品で `icon_url` が NULL でない最新行
 *   3. それでも無ければ `collab` 作品で同様
 *   4. それでも無ければ null のまま
 *
 * x_users.icon_url は `creatorIconExpr` で既に COALESCE されている前提なので、
 * 本関数は「video.icon_url も x_users.icon_url も NULL の行」だけを救済する。
 */
export async function resolveMissingIcons<
  T extends { creator_id: string | null; icon_url: string | null },
>(db: DB, rows: T[]): Promise<T[]> {
  const missing = rows.filter((r) => !r.icon_url && r.creator_id);
  if (missing.length === 0) return rows;

  const creatorIds = Array.from(
    new Set(missing.map((r) => r.creator_id).filter((s): s is string => !!s)),
  );
  if (creatorIds.length === 0) return rows;

  // 個人作 → 合作の順で取得し、Map<creatorId, iconUrl> を作る。
  const individualRows = await db
    .select({
      creator_id: videos.creator_id,
      icon_url: videos.icon_url,
      created_at: videos.created_at,
    })
    .from(videos)
    .where(
      and(
        inArray(videos.creator_id, creatorIds),
        isNotNull(videos.icon_url),
        eq(videos.submission_type, "individual"),
        eq(videos.is_deleted, 0),
        ne(videos.status, "voided"),
      )!,
    )
    .orderBy(desc(videos.created_at));

  const collabRows = await db
    .select({
      creator_id: videos.creator_id,
      icon_url: videos.icon_url,
      created_at: videos.created_at,
    })
    .from(videos)
    .where(
      and(
        inArray(videos.creator_id, creatorIds),
        isNotNull(videos.icon_url),
        eq(videos.submission_type, "collab"),
        eq(videos.is_deleted, 0),
        ne(videos.status, "voided"),
      )!,
    )
    .orderBy(desc(videos.created_at));

  const icons = new Map<string, string>();
  // 個人作を先に登録 (最新の方が優先)
  for (const r of individualRows) {
    if (!r.creator_id || !r.icon_url) continue;
    if (!icons.has(r.creator_id)) icons.set(r.creator_id, r.icon_url);
  }
  // 個人作が無い場合だけ合作で埋める
  for (const r of collabRows) {
    if (!r.creator_id || !r.icon_url) continue;
    if (!icons.has(r.creator_id)) icons.set(r.creator_id, r.icon_url);
  }

  return rows.map((r) => {
    if (r.icon_url || !r.creator_id) return r;
    const replaced = icons.get(r.creator_id);
    return replaced ? { ...r, icon_url: replaced } : r;
  });
}
