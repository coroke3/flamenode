import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import {
  events,
  eventStaff,
  videos,
  xUsers,
} from "./schema";
import { creatorIconExpr, creatorNameExpr } from "./displayExpr";
import { resolveMissingIcons } from "./iconResolution";
import { resolveMemberIcons } from "./xIconResolution";
import type { DB } from "./client";
import { uniqueBy } from "@/lib/utils/unique";
import {
  coalescedVideoScore,
  coalescedVideoScoreAsc,
  coalescedVideoScoreDesc,
} from "./videoScoreSql";
import { compareEventsByUpcomingPriority } from "@/lib/utils/eventOrdering";
import {
  activeEventWhere,
  publicListableEventWhere,
} from "@/lib/utils/eventStatus";
import {
  isPickupCreatorEligible,
  sortPickupCreators,
} from "@/lib/utils/pickupCreators";

export const PVSF_SUMMARY_EVENT_ID = "PVSFSummary";
/**
 * 公開済みかつ表示対象の作品を絞り込む共通条件。
 *  - visibility_status == "public"
 */
export const publicVideoCondition = eq(videos.visibility_status, "public");

const publicVideoListSelect = {
  id: videos.id,
  title: videos.title,
  youtube_video_id: videos.youtube_video_id,
  display_name: creatorNameExpr,
  icon_url: creatorIconExpr,
  creator_x_user_id: videos.creator_x_user_id,
  primary_event_id: videos.primary_event_id,
  scheduled_time: videos.scheduled_time,
  part: videos.part,
} as const;

const scoredPublicVideoListSelect = {
  ...publicVideoListSelect,
  video_score: coalescedVideoScore,
} as const;

const eventPublicVideoListSelect = {
  id: publicVideoListSelect.id,
  title: publicVideoListSelect.title,
  youtube_video_id: publicVideoListSelect.youtube_video_id,
  display_name: publicVideoListSelect.display_name,
  icon_url: publicVideoListSelect.icon_url,
  creator_x_user_id: publicVideoListSelect.creator_x_user_id,
  scheduled_time: publicVideoListSelect.scheduled_time,
  part: publicVideoListSelect.part,
} as const;

export function excludePvsfSummaryVideos() {
  return sql`
    COALESCE(${videos.primary_event_id}, '') <> ${PVSF_SUMMARY_EVENT_ID}
    AND NOT EXISTS (
      SELECT 1 FROM video_events AS pvsf_summary_video_events
      WHERE pvsf_summary_video_events.video_id = ${videos.id}
        AND pvsf_summary_video_events.event_id = ${PVSF_SUMMARY_EVENT_ID}
    )
  `;
}
export const countablePublicVideoCondition = and(
  publicVideoCondition,
  excludePvsfSummaryVideos(),
)!;

/** video_events または primary_event_id でイベントに紐づく公開作品。 */
export function eventPublicVideoLinkCondition(eventId: string) {
  return or(
    sql`EXISTS (
      SELECT 1 FROM video_events AS event_video_links
      WHERE event_video_links.video_id = ${videos.id}
        AND event_video_links.event_id = ${eventId}
    )`,
    eq(videos.primary_event_id, eventId),
  )!;
}

function publicEventVideoCondition(eventId: string) {
  return and(
    countablePublicVideoCondition,
    eventPublicVideoLinkCondition(eventId),
  )!;
}

/** トップページのおすすめ作品候補（score 上位）。 */
export async function fetchRecommendedVideos(db: DB, limit = 40) {
  const rows = await db
    .select(scoredPublicVideoListSelect)
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
    .where(publicVideoCondition)
    .orderBy(coalescedVideoScoreDesc, desc(videos.scheduled_time))
    .limit(limit);
  return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
}

/**
 * 「見逃されている」候補。
 *
 * 単純に score 上位だけだと毎回同じ作品が顔を出すため、
 * 公開作品のうち score が低めの候補を新しい順で混ぜる。
 * score 未適用 DB では scheduled_time ベースのフォールバックになる。
 * 呼び出し側 (`/recommend`) で `limitByCreatorAndEvent` を通して、作者・
 * イベントの偏りを抑えて 6 件程度に絞る前提の候補プール。
 *
 * 真のパーソナライズではないが、毎日同じ顔を見せない最低限の rotation として
 * 扱う。
 */
export async function fetchUnderratedVideos(db: DB, limit = 60) {
  const rows = await db
    .select(scoredPublicVideoListSelect)
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
    .where(publicVideoCondition)
    .orderBy(coalescedVideoScoreAsc, desc(videos.scheduled_time))
    .limit(limit);
  return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
}

/** 最新作品 (scheduled_time 降順)。 */
export async function fetchLatestVideos(db: DB, limit = 30) {
  const rows = await db
    .select(publicVideoListSelect)
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
    .where(publicVideoCondition)
    .orderBy(desc(videos.scheduled_time))
    .limit(limit);
  return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
}

/** 直近 N 件のイベント。 */
export async function fetchLatestEvents(db: DB, limit = 3) {
  const rows = await db
    .select()
    .from(events)
    .where(publicListableEventWhere())
    .orderBy(desc(events.start_time));
  return rows.sort(compareEventsByUpcomingPriority).slice(0, limit);
}

/** イベント詳細など: 紐づく公開作品を上映順ですべて返す。 */
export async function fetchAllPublicVideosForEvent(db: DB, eventId: string) {
  const rows = await db
    .select(eventPublicVideoListSelect)
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
    .where(publicEventVideoCondition(eventId))
    .orderBy(asc(videos.scheduled_time), asc(videos.id));
  return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
}

export async function countVideosForEvent(
  db: DB,
  eventId: string,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(videos)
    .where(publicEventVideoCondition(eventId))
    .limit(1);

  return Number(rows[0]?.count ?? 0);
}

/** 開催中イベント (visibility_status=public かつ期間内かつ非アーカイブ)。 */
export async function fetchActiveEvents(db: DB) {
  const rows = await db
    .select()
    .from(events)
    .where(activeEventWhere())
    .orderBy(desc(events.start_time));
  return rows.sort(compareEventsByUpcomingPriority);
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
  const editorsWithIcons = await resolveMemberIcons(db, editors);
  return { event: ev[0], editors: editorsWithIcons };
}

/** ピックアップクリエイター候補 (個人作1件以上 or 合作参加2件以上)。作品数の多い順。 */
export async function fetchPickupCreators(db: DB, limit = 40) {
  // 集計: 個人作品数 + 合作参加数で絞る。
  // Drizzle の sql 断片内で ${xUsers.id} 等を埋め込むと D1 が `id` だけに展開し
  // 「ambiguous column name: id」になることがあるため、相関は生 SQL で明示する。
  const personalVideoCountSql = sql<number>`(
    SELECT COUNT(DISTINCT v.id) FROM videos AS v
    WHERE v.creator_x_user_id = "x_users"."id"
      AND v.visibility_status = 'public'
      AND COALESCE(v.primary_event_id, '') <> ${PVSF_SUMMARY_EVENT_ID}
      AND NOT EXISTS (
        SELECT 1 FROM video_events AS pvsf_summary_video_events
        WHERE pvsf_summary_video_events.video_id = v.id
          AND pvsf_summary_video_events.event_id = ${PVSF_SUMMARY_EVENT_ID}
      )
  )`;
  const collabVideoCountSql = sql<number>`(
    SELECT COUNT(DISTINCT vm.video_id) FROM video_members AS vm
    INNER JOIN videos AS v ON v.id = vm.video_id
    WHERE vm.x_user_id = "x_users"."id"
      AND v.visibility_status = 'public'
      AND COALESCE(v.primary_event_id, '') <> ${PVSF_SUMMARY_EVENT_ID}
      AND NOT EXISTS (
        SELECT 1 FROM video_events AS pvsf_summary_video_events
        WHERE pvsf_summary_video_events.video_id = v.id
          AND pvsf_summary_video_events.event_id = ${PVSF_SUMMARY_EVENT_ID}
      )
  )`;
  const totalWorkCountSql = sql<number>`(${personalVideoCountSql} + ${collabVideoCountSql})`;

  const candidateLimit = Math.max(limit * 6, 160);
  const rows = await db
    .select({
      id: xUsers.id,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
      video_count: personalVideoCountSql,
      collab_count: collabVideoCountSql,
    })
    .from(xUsers)
    .where(or(eq(xUsers.approval_status, "approved"), eq(xUsers.approval_status, "pending"))!)
    .orderBy(desc(totalWorkCountSql), desc(personalVideoCountSql), asc(xUsers.x_name))
    .limit(candidateLimit);

  const picked = sortPickupCreators(rows)
    .filter((row) => isPickupCreatorEligible(row))
    .slice(0, limit);
  const withIcons = await resolveMemberIcons(
    db,
    picked.map((row) => ({
      ...row,
      x_user_id: row.id,
    })),
  );
  return withIcons.map(({ x_user_id: _xUserId, ...row }) => row);
}
