import { and, desc, eq, gte, isNotNull, ne, or, sql } from "drizzle-orm";
import {
  events,
  eventEditors,
  videos,
  videoEvents,
  videoMembers,
  xUsers,
} from "./schema";
import { creatorIconExpr, creatorNameExpr } from "./displayExpr";
import { resolveMissingIcons } from "./iconResolution";
import type { DB } from "./client";

/**
 * 公開済みかつ表示対象の作品を絞り込む共通条件。
 *  - status == "public"
 *  - is_deleted = 0
 *  - is_manual_hidden = 0
 */
export const publicVideoCondition = and(
  eq(videos.status, "public"),
  eq(videos.is_deleted, 0),
  eq(videos.is_manual_hidden, 0),
);

/** トップページのおすすめ作品候補 (video_score 上位 N 件)。 */
export async function fetchRecommendedVideos(db: DB, limit = 40) {
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: creatorNameExpr,
      icon_url: creatorIconExpr,
      creator_id: videos.creator_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
      video_score: videos.video_score,
    })
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
    .where(publicVideoCondition)
    .orderBy(desc(videos.video_score), desc(videos.scheduled_time))
    .limit(limit);
  return resolveMissingIcons(db, rows);
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
      creator_id: videos.creator_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
    })
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
    .where(publicVideoCondition)
    .orderBy(desc(videos.scheduled_time))
    .limit(limit);
  return resolveMissingIcons(db, rows);
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
      creator_id: videos.creator_id,
      scheduled_time: videos.scheduled_time,
    })
    .from(videos)
    .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
    .where(and(publicVideoCondition, eq(videoEvents.event_id, eventId))!)
    .orderBy(desc(videos.scheduled_time))
    .limit(limit);
  return resolveMissingIcons(db, rows);
}

/** 開催中イベント (is_active=1)。 */
export async function fetchActiveEvents(db: DB) {
  return db
    .select()
    .from(events)
    .where(eq(events.is_active, 1))
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
        ne(videos.status, "voided"),
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
      x_user_id: eventEditors.x_user_id,
      role: eventEditors.role,
      is_public: eventEditors.is_public,
      public_role_label: eventEditors.public_role_label,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
    })
    .from(eventEditors)
    .leftJoin(xUsers, eq(xUsers.id, eventEditors.x_user_id))
    .where(eq(eventEditors.event_id, eventId));
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
  return db
    .select({
      id: xUsers.id,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
      video_count: sql<number>`(
        SELECT COUNT(DISTINCT v.id) FROM videos AS v
        WHERE v.creator_id = "x_users"."id"
          AND v.status = 'public' AND v.is_deleted = 0 AND v.is_manual_hidden = 0
      )`,
      collab_count: sql<number>`(
        SELECT COUNT(DISTINCT vm.video_id) FROM video_members AS vm
        INNER JOIN videos AS v ON v.id = vm.video_id
        WHERE vm.x_user_id = "x_users"."id"
          AND v.status = 'public' AND v.is_deleted = 0 AND v.is_manual_hidden = 0
      )`,
    })
    .from(xUsers)
    .where(or(eq(xUsers.approval_status, "approved"), eq(xUsers.approval_status, "pending"))!)
    .limit(limit * 2)
    .then((rows) =>
      rows
        .filter(
          (r) => (r.video_count ?? 0) >= 1 || (r.collab_count ?? 0) >= 2,
        )
        .slice(0, limit),
    );
}
