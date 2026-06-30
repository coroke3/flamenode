import type { DB } from "./client";
import { resolveMemberIcons } from "./xIconResolution";

/**
 * 旧サイト互換のアイコン解決ヘルパー。
 *
 * 各行に `creator_x_user_id` と `icon_url` (NULL 可) が入っている前提で、
 * `icon_url` が NULL の行を「同 creator_x_user_id の過去作品」から補う。
 *
 * 実装は `resolveMemberIcons` に委譲（x_user_id キーの共通ロジック）。
 */
export async function resolveMissingIcons<
  T extends { creator_x_user_id: string | null; icon_url: string | null },
>(db: DB, rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;

  const mapped = rows.map((row) => ({
    ...row,
    x_user_id: row.creator_x_user_id,
  }));
  const resolved = await resolveMemberIcons(db, mapped);
  return resolved.map(({ x_user_id: _xUserId, ...row }) => row as unknown as T);
}
