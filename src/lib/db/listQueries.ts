import { and, asc, desc, eq, exists, or, sql } from "drizzle-orm";
import { videoChapters, videoMembers, videos, videoEvents, xUsers } from "./schema";
import { coalescedVideoScoreDesc } from "./videoScoreSql";
import { creatorIconExpr, creatorNameExpr } from "./displayExpr";
import { resolveMissingIcons } from "./iconResolution";
import {
  countablePublicVideoCondition,
  eventPublicVideoLinkCondition,
} from "./queries";
import type { DB } from "./client";
import { uniqueBy } from "@/lib/utils/unique";

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

function likeColumn(column: unknown, term: string) {
  return sql`${column} LIKE ${term} ESCAPE '\\'`;
}

/** 公開作品一覧のキーワード検索条件。 */
function buildPublicVideoSearchCondition(db: DB, q: string | undefined) {
  const trimmed = q?.trim();
  if (!trimmed) return undefined;

  const term = `%${escapeLikeTerm(trimmed)}%`;

  return or(
    likeColumn(videos.title, term),
    likeColumn(videos.creator_display_name, term),
    likeColumn(videos.creator_display_name_yomi, term),
    likeColumn(videos.creator_x_user_id, term),
    likeColumn(videos.music, term),
    likeColumn(videos.credit, term),
    likeColumn(videos.intro_comment, term),
    likeColumn(videos.closing_comment, term),
    likeColumn(videos.highlights, term),
    likeColumn(videos.production_story, term),
    exists(
      db
        .select({ one: sql`1` })
        .from(xUsers)
        .where(
          and(
            eq(xUsers.id, videos.creator_x_user_id),
            or(likeColumn(xUsers.x_name, term), likeColumn(xUsers.id, term)),
          ),
        ),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(videoChapters)
        .where(
          and(
            eq(videoChapters.video_id, videos.id),
            eq(videoChapters.visibility, "public"),
            or(
              likeColumn(videoChapters.chapter_label, term),
              likeColumn(videoChapters.note, term),
            ),
          ),
        ),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(videoMembers)
        .where(
          and(
            eq(videoMembers.video_id, videos.id),
            or(
              likeColumn(videoMembers.name, term),
              likeColumn(videoMembers.comment, term),
              likeColumn(videoMembers.role, term),
              likeColumn(videoMembers.x_user_id, term),
            ),
          ),
        ),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(videoMembers)
        .innerJoin(xUsers, eq(xUsers.id, videoMembers.x_user_id))
        .where(
          and(
            eq(videoMembers.video_id, videos.id),
            or(likeColumn(xUsers.x_name, term), likeColumn(xUsers.id, term)),
          ),
        ),
    ),
  );
}

const publicVideoListSelect = {
  id: videos.id,
  title: videos.title,
  youtube_video_id: videos.youtube_video_id,
  display_name: creatorNameExpr,
  icon_url: creatorIconExpr,
  creator_x_user_id: videos.creator_x_user_id,
  primary_event_id: videos.primary_event_id,
  scheduled_time: videos.scheduled_time,
  status: videos.visibility_status,
  part: videos.part,
} as const;

function publicVideoOrderBy(sort: "new" | "old" | "score") {
  if (sort === "old") return asc(videos.scheduled_time);
  if (sort === "score") return coalescedVideoScoreDesc;
  return desc(videos.scheduled_time);
}

/**
 * 公開作品の汎用一覧取得。検索 / イベント絞り込み / ソート / ページング。
 */
export async function fetchPublicVideos(db: DB, params: ListVideoParams) {
  const { q, sort = "new", eventId, limit = 24, offset = 0 } = params;

  const baseWhere = and(eq(videos.visibility_status, "public"));

  const filters = [baseWhere];
  const searchFilter = buildPublicVideoSearchCondition(db, q);
  if (searchFilter) filters.push(searchFilter);

  const orderBy = publicVideoOrderBy(sort);

  if (eventId) {
    const eventFilters = [
      countablePublicVideoCondition,
      eventPublicVideoLinkCondition(eventId),
    ];
    if (searchFilter) eventFilters.push(searchFilter);
    const rows = await db
      .select(publicVideoListSelect)
      .from(videos)
      .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
      .where(and(...eventFilters)!)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);
    return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
  }

  const rows = await db
    .select(publicVideoListSelect)
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
    .where(and(...filters)!)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);
  return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
}

/** 公開作品の単体取得。UUID / YouTube ID のどちらでも解決する。 */
export async function fetchPublicVideoByIdOrYoutube(db: DB, idOrYoutube: string) {
  const rows = await db
    .select(publicVideoListSelect)
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
    .where(
      and(
        eq(videos.visibility_status, "public"),
        or(eq(videos.id, idOrYoutube), eq(videos.youtube_video_id, idOrYoutube)),
      )!,
    )
    .limit(1);
  return (await resolveMissingIcons(db, rows))[0] ?? null;
}

/** 公開作品の総数 (ページング用)。 */
export async function countPublicVideos(db: DB, params: ListVideoParams) {
  const { q, eventId } = params;
  const baseWhere = and(eq(videos.visibility_status, "public"));
  const filters = [baseWhere];
  const searchFilter = buildPublicVideoSearchCondition(db, q);
  if (searchFilter) filters.push(searchFilter);
  if (eventId) {
    const eventFilters = [
      countablePublicVideoCondition,
      eventPublicVideoLinkCondition(eventId),
    ];
    if (searchFilter) eventFilters.push(searchFilter);
    const rows = await db
      .select({ c: sql<number>`count(*)` })
      .from(videos)
      .where(and(...eventFilters)!);
    return Number(rows[0]?.c ?? 0);
  }
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(videos)
    .where(and(...filters)!);
  return Number(rows[0]?.c ?? 0);
}
