import { sql, type SQLWrapper } from "drizzle-orm";
import { videos, xUsers } from "./schema";

/**
 * 動画カードで使う「表示名」「アイコン URL」の SQL 共通フラグメント。
 * 旧サイト互換: video.display_name を最優先し、x_users 連携が後段。
 *
 * 利用条件: SELECT で `videos` と `xUsers` を `xUsers.id = videos.creator_id` でleftJoin している。
 */
export const creatorNameExpr = sql<string>`COALESCE(${videos.display_name}, ${xUsers.x_name}, '@' || ${videos.contact_x_id})`;

/**
 * 1段目のアイコンフォールバック (DB 単発で済む)。
 * `video.icon_url` → `x_users.icon_url` → null。
 * NULL のまま残った行は `resolveMissingIcons` で過去作品から穴埋めする。
 */
export const creatorIconExpr = sql<
  string | null
>`COALESCE(${videos.icon_url}, ${xUsers.icon_url})`;

/** 任意の column 群を組み合わせた COALESCE。複雑なケース用。 */
export function coalesceExpr<T>(...args: SQLWrapper[]): import("drizzle-orm").SQL<T> {
  if (args.length === 0) throw new Error("coalesceExpr requires args");
  return sql<T>`COALESCE(${sql.join(args, sql`, `)})`;
}
