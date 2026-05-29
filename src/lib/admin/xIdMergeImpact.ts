import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  eventStaff,
  slots,
  videoChapters,
  videoInteractions,
  videoMembers,
  videos,
  xUserAliases,
  xUserIcons,
} from "@/lib/db/schema";
export {
  summarizeMergeImpact,
  totalMergeImpact,
  type XIdMergeImpactItem,
} from "./xIdMergeImpactCore";
import type { XIdMergeImpactItem } from "./xIdMergeImpactCore";

type AnyDb = LibSQLDatabase<any>;

export async function fetchXIdMergeImpact(
  db: AnyDb,
  fromXId: string,
): Promise<XIdMergeImpactItem[]> {
  const [
    creatorVideos,
    members,
    chapters,
    interactions,
    icons,
    staff,
    aliasesOwned,
    aliasesPointing,
    slotRows,
  ] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(videos).where(eq(videos.creator_x_user_id, fromXId)),
    db.select({ c: sql<number>`COUNT(*)` }).from(videoMembers).where(eq(videoMembers.x_user_id, fromXId)),
    db.select({ c: sql<number>`COUNT(*)` }).from(videoChapters).where(eq(videoChapters.x_user_id, fromXId)),
    db.select({ c: sql<number>`COUNT(*)` }).from(videoInteractions).where(eq(videoInteractions.x_user_id, fromXId)),
    db.select({ c: sql<number>`COUNT(*)` }).from(xUserIcons).where(eq(xUserIcons.x_user_id, fromXId)),
    db.select({ c: sql<number>`COUNT(*)` }).from(eventStaff).where(eq(eventStaff.x_user_id, fromXId)),
    db.select({ c: sql<number>`COUNT(*)` }).from(xUserAliases).where(eq(xUserAliases.x_user_id, fromXId)),
    db.select({ c: sql<number>`COUNT(*)` }).from(xUserAliases).where(eq(xUserAliases.alias_x_id, fromXId)),
    db.select({ c: sql<number>`COUNT(*)` }).from(slots).where(eq(slots.x_user_id, fromXId)),
  ]);

  return [
    { key: "videos.creator_x_user_id", label: "作品投稿者", count: Number(creatorVideos[0]?.c ?? 0) },
    { key: "video_members.x_user_id", label: "合作メンバー", count: Number(members[0]?.c ?? 0) },
    { key: "video_chapters.x_user_id", label: "チャプター", count: Number(chapters[0]?.c ?? 0) },
    { key: "video_interactions.x_user_id", label: "いいね/保存", count: Number(interactions[0]?.c ?? 0) },
    { key: "x_user_icons.x_user_id", label: "X IDアイコン", count: Number(icons[0]?.c ?? 0) },
    { key: "event_staff.x_user_id", label: "イベントスタッフ", count: Number(staff[0]?.c ?? 0) },
    { key: "x_user_aliases.x_user_id", label: "alias所有", count: Number(aliasesOwned[0]?.c ?? 0) },
    { key: "x_user_aliases.alias_x_id", label: "alias参照", count: Number(aliasesPointing[0]?.c ?? 0) },
    { key: "slots.x_user_id", label: "予約枠", count: Number(slotRows[0]?.c ?? 0) },
  ];
}
