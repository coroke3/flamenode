import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { videos, videoEvents, xUsers } from "./schema";
import { creatorIconExpr, creatorNameExpr } from "./displayExpr";
import { resolveMissingIcons } from "./iconResolution";
import type { DB } from "./client";

export interface ListVideoParams {
  q?: string;
  sort?: "new" | "old" | "score";
  eventId?: string;
  limit?: number;
  offset?: number;
}

/**
 * 公開作品の汎用一覧取得。検索 / イベント絞り込み / ソート / ページング。
 */
export async function fetchPublicVideos(db: DB, params: ListVideoParams) {
  const { q, sort = "new", eventId, limit = 24, offset = 0 } = params;

  const baseWhere = and(
    eq(videos.status, "public"),
    eq(videos.is_deleted, 0),
    eq(videos.is_manual_hidden, 0),
  );

  const filters = [baseWhere];
  if (q && q.trim()) {
    const term = `%${q.trim().replace(/[%_]/g, (m) => "\\" + m)}%`;
    filters.push(
      or(
        like(videos.title, term),
        like(videos.display_name, term),
        like(videos.music, term),
      )!,
    );
  }

  const orderBy =
    sort === "old"
      ? asc(videos.scheduled_time)
      : sort === "score"
        ? desc(videos.video_score)
        : desc(videos.scheduled_time);

  if (eventId) {
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
        status: videos.status,
      })
      .from(videos)
      .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
      .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
      .where(and(...filters, eq(videoEvents.event_id, eventId))!)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);
    return resolveMissingIcons(db, rows);
  }

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
      status: videos.status,
    })
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
    .where(and(...filters)!)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);
  return resolveMissingIcons(db, rows);
}

/** 公開作品の総数 (ページング用)。 */
export async function countPublicVideos(db: DB, params: ListVideoParams) {
  const { q, eventId } = params;
  const baseWhere = and(
    eq(videos.status, "public"),
    eq(videos.is_deleted, 0),
    eq(videos.is_manual_hidden, 0),
  );
  const filters = [baseWhere];
  if (q && q.trim()) {
    const term = `%${q.trim().replace(/[%_]/g, (m) => "\\" + m)}%`;
    filters.push(
      or(
        like(videos.title, term),
        like(videos.display_name, term),
        like(videos.music, term),
      )!,
    );
  }
  if (eventId) {
    const rows = await db
      .select({ c: sql<number>`count(*)` })
      .from(videos)
      .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
      .where(and(...filters, eq(videoEvents.event_id, eventId))!);
    return Number(rows[0]?.c ?? 0);
  }
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(videos)
    .where(and(...filters)!);
  return Number(rows[0]?.c ?? 0);
}
