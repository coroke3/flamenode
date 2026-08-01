import { sql } from "drizzle-orm";
import { videos } from "./schema";

/**
 * 動画カードで使う「表示名」「アイコン URL」の SQL 共通フラグメント。
 * 作品スナップショット（videos.creator_*）のみ。x_users や他作品からは補完しない。
 */
export const creatorNameExpr = sql<string>`COALESCE(NULLIF(TRIM(${videos.creator_display_name}), ''), ${videos.creator_x_user_id}, '')`;

/** 作品に保存された投稿者名のみ。x_users からは補完しない。 */
export const storedCreatorNameExpr = sql<string>`COALESCE(NULLIF(TRIM(${videos.creator_display_name}), ''), ${videos.creator_x_user_id})`;

/**
 * 作品カード用のアイコン（videos.creator_icon_url のみ）。
 * 単一 X ID の代表アイコンは `xIconResolution.resolveXUserIcon` を使う。
 */
export const creatorIconExpr = sql<string | null>`${videos.creator_icon_url}`;
