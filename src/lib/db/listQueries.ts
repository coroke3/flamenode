import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { videos, videoEvents, xUsers } from "./schema";
import { coalescedVideoScoreDesc } from "./videoScoreSql";
import { creatorIconExpr, creatorNameExpr } from "./displayExpr";
import { resolveMissingIcons } from "./iconResolution";
import {
  withMissingColumnFallback,
  withVideoScoreFallback,
} from "./queryFallback";
import type { DB } from "./client";
import { uniqueBy } from "@/lib/utils/unique";

const nullVideoPart = sql<string | null>`NULL`;

async function withVideoPartFallback<T>(
  run: (includePart: boolean) => Promise<T>,
): Promise<T> {
  return withMissingColumnFallback("part", run);
}

export interface ListVideoParams {
  q?: string;
  sort?: "new" | "old" | "score";
  eventId?: string;
  limit?: number;
  offset?: number;
}

/** 公開作品 API / 一覧ページ用の sort 正規化（未知値は new）。 */
export function parsePublicVideoSort(
  value: string | null | undefined,
): "new" | "old" | "score" {
  if (value === "old" || value === "score") return value;
  return "new";
}

/**
 * SQLite の LIKE で `%` / `_` を ESCAPE '\' 経由でリテラル扱いするための前処理。
 * バックスラッシュ自体も二重化しないと "\X" の X を escape 対象として食ってしまうので
 * `\\` を最初にエスケープする。
 */
function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * 公開作品の汎用一覧取得。検索 / イベント絞り込み / ソート / ページング。
 */
export async function fetchPublicVideos(db: DB, params: ListVideoParams) {
  const { q, sort = "new", eventId, limit = 24, offset = 0 } = params;

  const baseWhere = and(
    eq(videos.visibility_status, "public"),
  );

  const filters = [baseWhere];
  if (q && q.trim()) {
    const term = `%${escapeLikeTerm(q.trim())}%`;
    filters.push(
      or(
        sql`${videos.title} LIKE ${term} ESCAPE '\\'`,
        sql`${videos.creator_display_name} LIKE ${term} ESCAPE '\\'`,
        sql`${videos.music} LIKE ${term} ESCAPE '\\'`,
      )!,
    );
  }

  return withVideoScoreFallback(async (hasScore) => {
    const effectiveSort =
      sort === "score" && !hasScore ? "new" : sort;
    const orderBy =
      effectiveSort === "old"
        ? asc(videos.scheduled_time)
        : effectiveSort === "score"
          ? coalescedVideoScoreDesc
          : desc(videos.scheduled_time);

    if (eventId) {
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
            status: videos.visibility_status,
            part: includePart ? videos.part : nullVideoPart,
          })
          .from(videos)
          .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
          .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
          .where(and(...filters, eq(videoEvents.event_id, eventId))!)
          .orderBy(orderBy)
          .limit(limit)
          .offset(offset),
      );
      return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
    }

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
          status: videos.visibility_status,
          part: includePart ? videos.part : nullVideoPart,
        })
        .from(videos)
        .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
        .where(and(...filters)!)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),
    );
    return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
  });
}

/** 公開作品の総数 (ページング用)。 */
export async function countPublicVideos(db: DB, params: ListVideoParams) {
  const { q, eventId } = params;
  const baseWhere = and(
    eq(videos.visibility_status, "public"),
  );
  const filters = [baseWhere];
  if (q && q.trim()) {
    const term = `%${escapeLikeTerm(q.trim())}%`;
    filters.push(
      or(
        sql`${videos.title} LIKE ${term} ESCAPE '\\'`,
        sql`${videos.creator_display_name} LIKE ${term} ESCAPE '\\'`,
        sql`${videos.music} LIKE ${term} ESCAPE '\\'`,
      )!,
    );
  }
  if (eventId) {
    const rows = await db
      .select({ c: sql<number>`count(DISTINCT ${videos.id})` })
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
