import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { videos, xUsers, xUserIcons } from "./schema";
import type { DB } from "./client";

/**
 * 単一 X ID のアイコンを解決する。
 *
 * 優先順位:
 *   1. x_users.icon_url
 *   2. 同 X ID の非削除・非 voided な作品の videos.creator_icon_url
 *      (個人作 → 合作、新しい順)
 *   3. null
 *
 * ユーザーページや、メンバー欄の単体解決などで使う。
 * 表示時に呼ぶ前提なので、status (public/pending/...) のフィルタは行わない
 * (呼び出し側が必要なら別途絞る)。
 */
export async function resolveXUserIcon(
  db: DB,
  xId: string,
): Promise<string | null> {
  if (!xId) return null;
  const xRow = (
    await db
      .select({ icon_url: xUsers.icon_url })
      .from(xUsers)
      .where(eq(xUsers.id, xId))
      .limit(1)
  )[0];
  if (xRow?.icon_url) return xRow.icon_url;

  const fallback = async (
    submissionType: "individual" | "collab",
  ): Promise<string | null> => {
    const row = (
      await db
        .select({ icon_url: videos.creator_icon_url })
        .from(videos)
        .where(
          and(
            eq(videos.creator_x_user_id, xId),
            isNotNull(videos.creator_icon_url),
            eq(videos.collaboration_type, submissionType),
            sql`${videos.visibility_status} NOT IN ('archived', 'voided')`,
          )!,
        )
        .orderBy(desc(videos.created_at))
        .limit(1)
    )[0];
    return row?.icon_url ?? null;
  };

  return (await fallback("individual")) ?? (await fallback("collab"));
}

/**
 * 合作メンバー行の `icon_url` を解決する。
 *
 * 入力行は `x_user_id` (member の X ID) と `icon_url` (xUsers leftJoin 由来) を
 * 持つことが前提。優先順位:
 *   1. 入力 row の icon_url (= 既に xUsers.icon_url で埋まっている)
 *   2. その X ID の過去作品アイコン (個人作 → 合作、新しい順)
 *   3. null
 *
 * `videoDetailQueries.fetchVideoDetail` の members 出力に対して使う。
 */
export async function resolveMemberIcons<
  T extends { x_user_id: string | null; icon_url: string | null },
>(db: DB, members: T[]): Promise<T[]> {
  const missing = members.filter((m) => !m.icon_url && m.x_user_id);
  if (missing.length === 0) return members;

  const xIds = Array.from(
    new Set(missing.map((m) => m.x_user_id).filter((s): s is string => !!s)),
  );
  if (xIds.length === 0) return members;

  // D1 (SQLite) は bind 変数に上限があるため chunk 化する。
  const CHUNK_SIZE = 25;
  type IconRow = { x_id: string | null; icon_url: string | null };
  async function fetchByType(
    submissionType: "individual" | "collab",
  ): Promise<IconRow[]> {
    const out: IconRow[] = [];
    for (let i = 0; i < xIds.length; i += CHUNK_SIZE) {
      const chunk = xIds.slice(i, i + CHUNK_SIZE);
      const rows = await db
        .select({
          x_id: videos.creator_x_user_id,
          icon_url: videos.creator_icon_url,
        })
        .from(videos)
        .where(
          and(
            inArray(videos.creator_x_user_id, chunk),
            isNotNull(videos.creator_icon_url),
            eq(videos.collaboration_type, submissionType),
            sql`${videos.visibility_status} NOT IN ('archived', 'voided')`,
          )!,
        )
        .orderBy(desc(videos.created_at));
      out.push(...rows);
    }
    return out;
  }

  const individualRows = await fetchByType("individual");
  const collabRows = await fetchByType("collab");

  const icons = new Map<string, string>();
  for (const r of individualRows) {
    if (!r.x_id || !r.icon_url) continue;
    if (!icons.has(r.x_id)) icons.set(r.x_id, r.icon_url);
  }
  for (const r of collabRows) {
    if (!r.x_id || !r.icon_url) continue;
    if (!icons.has(r.x_id)) icons.set(r.x_id, r.icon_url);
  }

  return members.map((m) => {
    if (m.icon_url || !m.x_user_id) return m;
    const replaced = icons.get(m.x_user_id);
    return replaced ? { ...m, icon_url: replaced } : m;
  });
}

/**
 * 投稿フォームと設定画面で使う X ID のアイコン候補リスト。
 *
 * 候補ソース (新しい順、重複除去):
 *   1. x_users.icon_url (ユーザー既定アイコン)
 *   2. x_user_icons.icon_url (手動アップロード履歴、過去作品由来候補)
 *   3. videos.creator_icon_url (creator_x_user_id または creator_x_user_id がこの X ID の作品)
 *
 * 設定画面の `setXIdIcon` の許可候補チェックや、
 * 投稿フォームのアイコンピッカーで共通利用する。
 */
export async function getXIconCandidates(
  db: DB,
  xId: string,
  limit = 24,
): Promise<string[]> {
  if (!xId) return [];
  const candidates: string[] = [];
  const seen = new Set<string>();

  const xRow = (
    await db
      .select({ icon_url: xUsers.icon_url })
      .from(xUsers)
      .where(eq(xUsers.id, xId))
      .limit(1)
  )[0];
  if (xRow?.icon_url) {
    candidates.push(xRow.icon_url);
    seen.add(xRow.icon_url);
    if (candidates.length >= limit) return candidates;
  }

  const iconRows = await db
    .select({ icon_url: xUserIcons.icon_url })
    .from(xUserIcons)
    .where(eq(xUserIcons.x_user_id, xId))
    .orderBy(desc(xUserIcons.created_at))
    .limit(limit * 2);
  for (const r of iconRows) {
    if (r.icon_url && !seen.has(r.icon_url)) {
      candidates.push(r.icon_url);
      seen.add(r.icon_url);
      if (candidates.length >= limit) return candidates;
    }
  }

  const videoRows = await db
    .select({ icon_url: videos.creator_icon_url })
    .from(videos)
    .where(
      and(
        eq(videos.creator_x_user_id, xId),
        isNotNull(videos.creator_icon_url),
      )!,
    )
    .orderBy(desc(videos.created_at))
    .limit(limit * 2);
  for (const r of videoRows) {
    if (r.icon_url && !seen.has(r.icon_url)) {
      candidates.push(r.icon_url);
      seen.add(r.icon_url);
      if (candidates.length >= limit) return candidates;
    }
  }

  return candidates;
}
