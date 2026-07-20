import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
export {
  summarizeMergeImpact,
  totalMergeImpact,
  type XIdMergeImpactItem,
} from "./xIdMergeImpactCore";
import type { XIdMergeImpactItem } from "./xIdMergeImpactCore";

type AnyDb = LibSQLDatabase<any>;

type MergeImpactCounts = {
  creatorVideos: number;
  members: number;
  chapters: number;
  interactions: number;
  accountLinks: number;
  staff: number;
  aliasesOwned: number;
  aliasesPointing: number;
  slotRows: number;
};

function count(value: unknown): number {
  return Number(value ?? 0);
}

export async function fetchXIdMergeImpact(
  db: AnyDb,
  fromXId: string,
): Promise<XIdMergeImpactItem[]> {
  const rows = await db
    .select({
      creatorVideos: sql<number>`(SELECT COUNT(*) FROM videos WHERE creator_x_user_id = ${fromXId})`,
      members: sql<number>`(SELECT COUNT(*) FROM video_members WHERE x_user_id = ${fromXId})`,
      chapters: sql<number>`(SELECT COUNT(*) FROM video_chapters WHERE x_user_id = ${fromXId})`,
      interactions: sql<number>`(SELECT COUNT(*) FROM video_interactions WHERE x_user_id = ${fromXId})`,
      accountLinks: sql<number>`(SELECT COUNT(*) FROM x_user_account_links WHERE x_user_id = ${fromXId})`,
      staff: sql<number>`(SELECT COUNT(*) FROM event_staff WHERE x_user_id = ${fromXId})`,
      aliasesOwned: sql<number>`(SELECT COUNT(*) FROM x_user_aliases WHERE x_user_id = ${fromXId})`,
      aliasesPointing: sql<number>`(SELECT COUNT(*) FROM x_user_aliases WHERE alias_x_id = ${fromXId})`,
      slotRows: sql<number>`(SELECT COUNT(*) FROM slots WHERE x_user_id = ${fromXId})`,
    })
    .from(sql`(SELECT 1) AS impact_source`);
  const counts = (rows[0] ?? {}) as Partial<MergeImpactCounts>;

  return [
    { key: "videos.creator_x_user_id", label: "作品投稿者", count: count(counts.creatorVideos) },
    { key: "video_members.x_user_id", label: "合作メンバー", count: count(counts.members) },
    { key: "video_chapters.x_user_id", label: "チャプター", count: count(counts.chapters) },
    { key: "video_interactions.x_user_id", label: "いいね/保存", count: count(counts.interactions) },
    { key: "x_user_account_links.x_user_id", label: "認証ユーザー紐付け", count: count(counts.accountLinks) },
    { key: "event_staff.x_user_id", label: "イベントスタッフ", count: count(counts.staff) },
    { key: "x_user_aliases.x_user_id", label: "alias所有", count: count(counts.aliasesOwned) },
    { key: "x_user_aliases.alias_x_id", label: "alias参照", count: count(counts.aliasesPointing) },
    { key: "slots.x_user_id", label: "予約枠", count: count(counts.slotRows) },
  ];
}
