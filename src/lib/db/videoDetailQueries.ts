import { and, asc, desc, eq, ne, or, sql } from "drizzle-orm";
import {
  events,
  videoChapters,
  videoComments,
  videoEvents,
  videoMembers,
  videos,
  xUsers,
} from "./schema";
import type { DB } from "./client";

/**
 * 作品詳細関連の集約クエリ。
 * Cloudflare D1 (SQLite) はネスト集約や CTE が制限的なので、複数クエリに分けてアプリ側で結合する。
 */

export async function fetchVideoDetail(db: DB, idOrYoutube: string) {
  // 1) 作品本体 (UUID または YouTubeID)
  const rows = await db
    .select()
    .from(videos)
    .where(
      or(
        eq(videos.id, idOrYoutube),
        eq(videos.youtube_video_id, idOrYoutube),
      )!,
    )
    .limit(1);
  const video = rows[0];
  if (!video) return null;

  // 2) 作者
  const creatorRows = video.creator_id
    ? await db
        .select()
        .from(xUsers)
        .where(eq(xUsers.id, video.creator_id))
        .limit(1)
    : [];
  const creator = creatorRows[0] ?? null;

  // 3) 所属イベント
  const eventRows = await db
    .select({
      id: events.id,
      title: events.title,
      icon_url: events.icon_url,
      accent_color: events.accent_color,
      start_time: events.start_time,
      end_time: events.end_time,
      is_active: events.is_active,
      is_archived: events.is_archived,
    })
    .from(videoEvents)
    .innerJoin(events, eq(videoEvents.event_id, events.id))
    .where(eq(videoEvents.video_id, video.id));

  // 4) 合作メンバー
  const members = await db
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
    .where(eq(videoMembers.video_id, video.id))
    .orderBy(videoMembers.order_index);

  // 5) チャプター (再生バー点表示の元データ)
  const chapters = await db
    .select({
      id: videoChapters.id,
      chapter_time: videoChapters.chapter_time,
      chapter_label: videoChapters.chapter_label,
      visibility: videoChapters.visibility,
      marker_kind: videoChapters.marker_kind,
      show_on_player_bar: videoChapters.show_on_player_bar,
      note: videoChapters.note,
      x_user_id: videoChapters.x_user_id,
      author_name: xUsers.x_name,
      author_icon: xUsers.icon_url,
    })
    .from(videoChapters)
    .leftJoin(xUsers, eq(xUsers.id, videoChapters.x_user_id))
    .where(
      and(
        eq(videoChapters.video_id, video.id),
        eq(videoChapters.visibility, "public"),
      )!,
    )
    .orderBy(videoChapters.chapter_time);

  // 6) コメント (チャプターと結合)
  const comments = await db
    .select({
      id: videoComments.id,
      body: videoComments.body,
      created_at: videoComments.created_at,
      chapter_id: videoComments.chapter_id,
      chapter_time: videoChapters.chapter_time,
      chapter_label: videoChapters.chapter_label,
      author_name: xUsers.x_name,
      author_icon: xUsers.icon_url,
    })
    .from(videoComments)
    .leftJoin(videoChapters, eq(videoChapters.id, videoComments.chapter_id))
    .leftJoin(xUsers, eq(xUsers.id, videoComments.x_user_id))
    .where(
      and(
        eq(videoComments.video_id, video.id),
        eq(videoComments.visibility, "public"),
      )!,
    )
    .orderBy(desc(videoComments.created_at))
    .limit(50);

  return { video, creator, events: eventRows, members, chapters, comments };
}

/**
 * 関連動画の取得 (簡易版): 同一作者 / 同一イベント / score 上位を混合。
 * 厳密な優先度付けと文脈近さ60% / score 40% の混合は将来 Worker で事前生成する。
 */
export async function fetchRelatedVideos(
  db: DB,
  current: { id: string; creator_id: string | null; primary_event_id: string | null },
  limit = 15,
) {
  const baseWhere = and(
    eq(videos.status, "public"),
    eq(videos.is_deleted, 0),
    eq(videos.is_manual_hidden, 0),
    ne(videos.id, current.id),
  );

  const iconExpr = sql<
    string | null
  >`COALESCE(${videos.icon_url}, ${xUsers.icon_url})`;

  const sameCreator = current.creator_id
    ? await db
        .select({
          id: videos.id,
          title: videos.title,
          youtube_video_id: videos.youtube_video_id,
          display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.display_name}, ${videos.contact_x_id})`,
          icon_url: iconExpr,
          creator_id: videos.creator_id,
          primary_event_id: videos.primary_event_id,
          scheduled_time: videos.scheduled_time,
        })
        .from(videos)
        .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
        .where(and(baseWhere, eq(videos.creator_id, current.creator_id))!)
        .orderBy(desc(videos.scheduled_time))
        .limit(4)
    : [];

  const sameEvent = current.primary_event_id
    ? await db
        .select({
          id: videos.id,
          title: videos.title,
          youtube_video_id: videos.youtube_video_id,
          display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.display_name}, ${videos.contact_x_id})`,
          icon_url: iconExpr,
          creator_id: videos.creator_id,
          primary_event_id: videos.primary_event_id,
          scheduled_time: videos.scheduled_time,
        })
        .from(videos)
        .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
        .where(
          and(baseWhere, eq(videos.primary_event_id, current.primary_event_id))!,
        )
        .orderBy(desc(videos.scheduled_time))
        .limit(6)
    : [];

  const topScore = await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.display_name}, ${videos.contact_x_id})`,
      icon_url: iconExpr,
      creator_id: videos.creator_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
    })
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
    .where(baseWhere)
    .orderBy(desc(videos.video_score))
    .limit(20);

  // 重複排除
  const map = new Map<string, (typeof topScore)[number]>();
  for (const v of [...sameCreator, ...sameEvent, ...topScore]) {
    if (!map.has(v.id)) map.set(v.id, v);
    if (map.size >= limit) break;
  }
  return Array.from(map.values()).slice(0, limit);
}

/**
 * 同一イベントの上映順 (scheduled_time 昇順) 全件を返す。
 * 再生リスト UI のソース。`primary_event_id` を主軸にする。
 */
export async function fetchEventPlaylistVideos(
  db: DB,
  eventId: string,
  limit = 50,
) {
  return db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.display_name}, ${videos.contact_x_id})`,
      scheduled_time: videos.scheduled_time,
    })
    .from(videos)
    .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
    .where(
      and(
        eq(videoEvents.event_id, eventId),
        eq(videos.status, "public"),
        eq(videos.is_deleted, 0),
        eq(videos.is_manual_hidden, 0),
      )!,
    )
    .orderBy(asc(videos.scheduled_time))
    .limit(limit);
}
