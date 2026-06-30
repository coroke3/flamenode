import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import {
  events,
  eventStaff,
  videos,
  videoEvents,
  videoMembers,
  xUsers,
} from "./schema";
import { creatorIconExpr, creatorNameExpr } from "./displayExpr";
import { resolveMissingIcons } from "./iconResolution";
import { resolveMemberIcons } from "./xIconResolution";
import {
  withMissingColumnFallback,
  withVideoScoreFallback,
} from "./queryFallback";
import type { DB } from "./client";
import { uniqueBy } from "@/lib/utils/unique";
import {
  coalescedVideoScore,
  coalescedVideoScoreAsc,
  coalescedVideoScoreDesc,
} from "./videoScoreSql";
import { compareEventsByUpcomingPriority } from "@/lib/utils/eventOrdering";
import {
  isPickupCreatorEligible,
  sortPickupCreators,
} from "@/lib/utils/pickupCreators";

const nullVideoPart = sql<string | null>`NULL`;
export const PVSF_SUMMARY_EVENT_ID = "PVSFSummary";

async function withVideoPartFallback<T>(
  run: (includePart: boolean) => Promise<T>,
): Promise<T> {
  return withMissingColumnFallback("part", run);
}

/**
 * 公開済みかつ表示対象の作品を絞り込む共通条件。
 *  - visibility_status == "public"
 */
export const publicVideoCondition = eq(videos.visibility_status, "public");
export const directVideoCondition = sql`${videos.visibility_status} IN ('public', 'limited')`;

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

export function publicEventVideoCondition(eventId: string) {
  return and(
    countablePublicVideoCondition,
    eventPublicVideoLinkCondition(eventId),
  )!;
}

/** トップページのおすすめ作品候補（videos.score 上位。列未適用 DB は新着順）。 */
export async function fetchRecommendedVideos(db: DB, limit = 40) {
  const rows = await withVideoScoreFallback((hasScore) =>
    withVideoPartFallback((includePart) =>
      db
        .select({
          id: videos.id,
          title: videos.title,
          youtube_video_id: videos.youtube_video_id,
          display_name: creatorNameExpr,
          icon_url: creatorIconExpr,
          creator_x_user_id: videos.creator_x_user_id,
          primary_event_id: videos.primary_event_id,
          scheduled_time: videos.scheduled_time,
          part: includePart ? videos.part : nullVideoPart,
          ...(hasScore ? { video_score: coalescedVideoScore } : {}),
        })
        .from(videos)
        .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
        .where(publicVideoCondition)
        .orderBy(
          ...(hasScore
            ? [coalescedVideoScoreDesc, desc(videos.scheduled_time)]
            : [desc(videos.scheduled_time)]),
        )
        .limit(limit),
    ),
  );
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
  const rows = await withVideoScoreFallback((hasScore) =>
    withVideoPartFallback((includePart) =>
      db
        .select({
          id: videos.id,
          title: videos.title,
          youtube_video_id: videos.youtube_video_id,
          display_name: creatorNameExpr,
          icon_url: creatorIconExpr,
          creator_x_user_id: videos.creator_x_user_id,
          primary_event_id: videos.primary_event_id,
          scheduled_time: videos.scheduled_time,
          part: includePart ? videos.part : nullVideoPart,
          ...(hasScore ? { video_score: coalescedVideoScore } : {}),
        })
        .from(videos)
        .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
        .where(publicVideoCondition)
        .orderBy(
          ...(hasScore
            ? [coalescedVideoScoreAsc, desc(videos.scheduled_time)]
            : [asc(videos.scheduled_time), desc(videos.id)]),
        )
        .limit(limit),
    ),
  );
  return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
}

/** 最新作品 (scheduled_time 降順)。 */
export async function fetchLatestVideos(db: DB, limit = 30) {
  const rows = await withVideoPartFallback((includePart) =>
    db
      .select({
        id: videos.id,
        title: videos.title,
        youtube_video_id: videos.youtube_video_id,
        display_name: creatorNameExpr,
        icon_url: creatorIconExpr,
        creator_x_user_id: videos.creator_x_user_id,
        primary_event_id: videos.primary_event_id,
        scheduled_time: videos.scheduled_time,
        part: includePart ? videos.part : nullVideoPart,
      })
      .from(videos)
      .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
      .where(publicVideoCondition)
      .orderBy(desc(videos.scheduled_time))
      .limit(limit),
  );
  return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
}

/** 直近 N 件のイベント。 */
export async function fetchLatestEvents(db: DB, limit = 3) {
  const rows = await db
    .select()
    .from(events)
    .where(or(eq(events.is_active, 1), eq(events.is_archived, 1))!)
    .orderBy(desc(events.start_time));
  return rows.sort(compareEventsByUpcomingPriority).slice(0, limit);
}

/** イベント詳細など: 紐づく公開作品を上映順ですべて返す。 */
export async function fetchAllPublicVideosForEvent(db: DB, eventId: string) {
  const rows = await withVideoPartFallback((includePart) =>
    db
      .select({
        id: videos.id,
        title: videos.title,
        youtube_video_id: videos.youtube_video_id,
        display_name: creatorNameExpr,
        icon_url: creatorIconExpr,
        creator_x_user_id: videos.creator_x_user_id,
        scheduled_time: videos.scheduled_time,
        part: includePart ? videos.part : nullVideoPart,
      })
      .from(videos)
      .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
      .where(publicEventVideoCondition(eventId))
      .orderBy(asc(videos.scheduled_time), asc(videos.id)),
  );
  return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
}

/** イベントに紐づく作品の先頭 N 件 (棚・プレビュー用)。 */
export async function fetchVideosForEvent(
  db: DB,
  eventId: string,
  limit = 8,
) {
  const rows = await fetchAllPublicVideosForEvent(db, eventId);
  return limit > 0 ? rows.slice(0, limit) : rows;
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

/** 開催中イベント (is_active=1 かつ期間内かつ非アーカイブ)。 */
export async function fetchActiveEvents(db: DB) {
  const { activeEventWhere } = await import("@/lib/utils/eventStatus");
  const rows = await db
    .select()
    .from(events)
    .where(activeEventWhere())
    .orderBy(desc(events.start_time));
  return rows.sort(compareEventsByUpcomingPriority);
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
  const editorsWithIcons = await resolveMemberIcons(db, editors);
  return { event: ev[0], editors: editorsWithIcons };
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
    .filter((r) => isPickupCreatorEligible(r))
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
