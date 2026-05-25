import { and, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import {
  events,
  eventStaff,
  videos,
  videoEvents,
  videoMembers,
  videoStats,
  xUsers,
} from "./schema";
import { creatorIconExpr, creatorNameExpr } from "./displayExpr";
import { resolveMissingIcons } from "./iconResolution";
import type { DB } from "./client";
import { uniqueBy } from "@/lib/utils/unique";

/**
 * 公開済みかつ表示対象の作品を絞り込む共通条件。
 *  - visibility_status == "public"
 */
export const publicVideoCondition = eq(videos.visibility_status, "public");
export const directVideoCondition = sql`${videos.visibility_status} IN ('public', 'limited')`;

/** トップページのおすすめ作品候補 (video_stats.score 上位 N 件)。 */
export async function fetchRecommendedVideos(db: DB, limit = 40) {
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: creatorNameExpr,
      icon_url: creatorIconExpr,
      creator_x_user_id: videos.creator_x_user_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
      video_score: sql<number>`COALESCE(${videoStats.score}, 0)`,
    })
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
    .leftJoin(videoStats, eq(videoStats.video_id, videos.id))
    .where(publicVideoCondition)
    .orderBy(desc(videoStats.score), desc(videos.scheduled_time))
    .limit(limit);
  return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
}

/**
 * 「見逃されている」候補。
 *
 * 単純に score 上位だけだと毎回同じ作品が顔を出すため、
 * 公開作品のうち score が低めの候補を新しい順で混ぜる。
 * video_stats が未集計で 0 の作品も初期本番では自然に露出させる。
 * 呼び出し側 (`/recommend`) で `limitByCreatorAndEvent` を通して、作者・
 * イベントの偏りを抑えて 6 件程度に絞る前提の候補プール。
 *
 * 真のパーソナライズではないが、毎日同じ顔を見せない最低限の rotation には
 * なる。将来的に signals が揃ったら別関数に置き換える。
 */
export async function fetchUnderratedVideos(db: DB, limit = 60) {
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: creatorNameExpr,
      icon_url: creatorIconExpr,
      creator_x_user_id: videos.creator_x_user_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
      video_score: sql<number>`COALESCE(${videoStats.score}, 0)`,
    })
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
    .leftJoin(videoStats, eq(videoStats.video_id, videos.id))
    .where(publicVideoCondition)
    .orderBy(asc(sql<number>`COALESCE(${videoStats.score}, 0)`), desc(videos.scheduled_time))
    .limit(limit);
  return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
}

/** 最新作品 (scheduled_time 降順)。 */
export async function fetchLatestVideos(db: DB, limit = 30) {
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: creatorNameExpr,
      icon_url: creatorIconExpr,
      creator_x_user_id: videos.creator_x_user_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
    })
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
    .where(publicVideoCondition)
    .orderBy(desc(videos.scheduled_time))
    .limit(limit);
  return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
}

/** 直近 N 件のイベント。 */
export async function fetchLatestEvents(db: DB, limit = 3) {
  return db
    .select()
    .from(events)
    .where(or(eq(events.is_active, 1), eq(events.is_archived, 1))!)
    .orderBy(desc(events.start_time))
    .limit(limit);
}

/** イベントに紐づく作品 (最大 N 件)。 */
export async function fetchVideosForEvent(
  db: DB,
  eventId: string,
  limit = 8,
) {
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: creatorNameExpr,
      icon_url: creatorIconExpr,
      creator_x_user_id: videos.creator_x_user_id,
      scheduled_time: videos.scheduled_time,
    })
    .from(videos)
    .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
    .where(and(publicVideoCondition, eq(videoEvents.event_id, eventId))!)
    .orderBy(desc(videos.scheduled_time))
    .limit(limit);
  return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
}

/** 開催中イベント (is_active=1 かつ期間内かつ非アーカイブ)。 */
export async function fetchActiveEvents(db: DB) {
  const { activeEventWhere } = await import("@/lib/utils/eventStatus");
  return db
    .select()
    .from(events)
    .where(activeEventWhere())
    .orderBy(desc(events.start_time));
}

/** YouTubeID または UUID で作品を引く。 */
export async function fetchVideoByIdOrYoutube(db: DB, idOrYoutube: string) {
  return db
    .select()
    .from(videos)
    .where(
      and(
        or(eq(videos.id, idOrYoutube), eq(videos.youtube_video_id, idOrYoutube))!,
        directVideoCondition,
      ),
    )
    .limit(1);
}

/** イベント情報＋編集者一覧。 */
export async function fetchEventWithEditors(db: DB, eventId: string) {
  const ev = await db
    .select()
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!ev[0]) return null;
  const editors = await db
    .select({
      x_user_id: eventStaff.x_user_id,
      role: eventStaff.role,
      is_public: eventStaff.is_public,
      public_role_label: eventStaff.public_role_label,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
    })
    .from(eventStaff)
    .leftJoin(xUsers, eq(xUsers.id, eventStaff.x_user_id))
    .where(eq(eventStaff.event_id, eventId));
  return { event: ev[0], editors };
}

/** 作品の合作メンバー一覧。 */
export async function fetchVideoMembers(db: DB, videoId: string) {
  return db
    .select({
      id: videoMembers.id,
      x_user_id: videoMembers.x_user_id,
      name: videoMembers.name,
      role: videoMembers.role,
      comment: videoMembers.comment,
      order_index: videoMembers.order_index,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
    })
    .from(videoMembers)
    .leftJoin(xUsers, eq(xUsers.id, videoMembers.x_user_id))
    .where(eq(videoMembers.video_id, videoId))
    .orderBy(videoMembers.order_index);
}

/** ピックアップクリエイター候補 (個人作1件以上 or 合作参加2件以上)。 */
export async function fetchPickupCreators(db: DB, limit = 40) {
  // 集計: 個人作品数 + 合作参加数で絞る。
  // Drizzle の sql 断片内で ${xUsers.id} 等を埋め込むと D1 が `id` だけに展開し
  // 「ambiguous column name: id」になることがあるため、相関は生 SQL で明示する。
  const rows = await db
    .select({
      id: xUsers.id,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
      video_count: sql<number>`(
        SELECT COUNT(DISTINCT v.id) FROM videos AS v
        WHERE v.creator_x_user_id = "x_users"."id"
          AND v.visibility_status = 'public'
      )`,
      collab_count: sql<number>`(
        SELECT COUNT(DISTINCT vm.video_id) FROM video_members AS vm
        INNER JOIN videos AS v ON v.id = vm.video_id
        WHERE vm.x_user_id = "x_users"."id"
          AND v.visibility_status = 'public'
      )`,
    })
    .from(xUsers)
    .where(or(eq(xUsers.approval_status, "approved"), eq(xUsers.approval_status, "pending"))!)
    .limit(limit * 2);
  const picked = rows
    .filter((r) => (r.video_count ?? 0) >= 1 || (r.collab_count ?? 0) >= 2)
    .slice(0, limit);
  const withIcons = await resolveMissingIcons(
    db,
    picked.map((row) => ({
      ...row,
      creator_x_user_id: row.id,
    })),
  );
  return withIcons.map(({ creator_x_user_id: _creatorId, ...row }) => row);
}
