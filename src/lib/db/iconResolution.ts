import type { DB } from "./client";

/**
 * 作品カード向けアイコン解決。
 * videos.creator_icon_url のみを正本とし、他作品からの穴埋めは行わない。
 */
export async function resolveMissingIcons<T extends { icon_url: string | null }>(
  _db: DB,
  rows: T[],
): Promise<T[]> {
  return rows;
}
