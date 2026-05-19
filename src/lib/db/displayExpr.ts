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
 * 作品カード用のアイコン解決 (1段目、DB 単発で済む)。
 *
 * 優先順位:
 *   1. videos.icon_url (作品ごとに指定されたアイコン)
 *   2. x_users.icon_url (X ID 既定アイコン)
 *   3. null (アプリ側で resolveMissingIcons により過去作品から穴埋め)
 *
 * 注意: ここでは `videos.icon_url` が最優先。投稿フォームから登録された
 * 作品アイコンが、ユーザー既定アイコンによって上書きされないようにする。
 * 単一 X ID のアイコンが欲しい場合は `xIconResolution.resolveXUserIcon` を使う。
 */
export const creatorIconExpr = sql<
  string | null
>`COALESCE(${videos.icon_url}, ${xUsers.icon_url})`;

/** 任意の column 群を組み合わせた COALESCE。複雑なケース用。 */
export function coalesceExpr<T>(...args: SQLWrapper[]): import("drizzle-orm").SQL<T> {
  if (args.length === 0) throw new Error("coalesceExpr requires args");
  return sql<T>`COALESCE(${sql.join(args, sql`, `)})`;
}
