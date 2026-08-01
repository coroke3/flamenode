import { and, desc, eq, isNotNull } from "drizzle-orm";
import { videos, xUsers } from "./schema";
import type { DB } from "./client";

/**
 * 登録済み X ID の代表アイコン（x_users.icon_url のみ）。
 * 過去作品の creator_icon_url にはフォールバックしない。
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
  return xRow?.icon_url ?? null;
}

/** 合作メンバー行の icon_url（x_users.icon_url のみ。過去作品からは補完しない）。 */
export async function resolveMemberIcons<
  T extends { icon_url: string | null },
>(_db: DB, members: T[]): Promise<T[]> {
  return members;
}

/** 投稿フォームと設定画面で使う X ID のアイコン候補リスト。 */
export async function getXIconCandidates(
  db: DB,
  xId: string,
  limit = 24,
): Promise<string[]> {
  if (!xId || limit <= 0) return [];
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

  const videoRows = await db
    .select({ icon_url: videos.creator_icon_url })
    .from(videos)
    .where(
      and(
        eq(videos.creator_x_user_id, xId),
        isNotNull(videos.creator_icon_url),
        eq(videos.visibility_status, "public"),
      )!,
    )
    .orderBy(desc(videos.created_at))
    .limit(limit * 2);
  for (const row of videoRows) {
    if (row.icon_url && !seen.has(row.icon_url)) {
      candidates.push(row.icon_url);
      seen.add(row.icon_url);
      if (candidates.length >= limit) return candidates;
    }
  }

  return candidates;
}

/**
 * 合作メンバーの表示名を解決する。
 * x_users.x_name → video_members.name → X ID。
 */
export async function resolveMemberNames<
  T extends {
    x_user_id: string | null;
    name: string | null;
    x_name: string | null;
  },
>(_db: DB, members: T[]): Promise<T[]> {
  return members.map((member) => {
    if (member.x_name || !member.x_user_id) return member;
    if (member.name) return { ...member, x_name: member.name };
    return { ...member, x_name: member.x_user_id };
  });
}
