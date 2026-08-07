import { and, asc, desc, eq, exists, or, sql } from "drizzle-orm";
import {
  events,
  videoChapters,
  videoMembers,
  videos,
  xUsers,
} from "./schema";
import { coalescedVideoScoreDesc } from "./videoScoreSql";
import { creatorIconExpr, creatorNameExpr } from "./displayExpr";
import { resolveMissingIcons } from "./iconResolution";
import {
  countablePublicVideoCondition,
  eventPublicVideoLinkCondition,
} from "./queries";
import type { DB } from "./client";
import { uniqueBy } from "@/lib/utils/unique";
import { resolveVideoPrimaryKey } from "./videoIdLookup";

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

/** SQLite LIKEで `%` / `_` / `\` をリテラル扱いする。 */
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
  primary_event_title: events.title,
  scheduled_time: videos.scheduled_time,
  status: videos.visibility_status,
  part: videos.part,
} as const;

const publicVideoPageSelect = {
  ...publicVideoListSelect,
  total_count: sql<number>`COUNT(*) OVER()`,
} as const;

function publicVideoOrderBy(sort: "new" | "old" | "score") {
  if (sort === "old") return asc(videos.scheduled_time);
  if (sort === "score") return coalescedVideoScoreDesc;
  return desc(videos.scheduled_time);
}

function publicVideoFilters(
  db: DB,
  params: Pick<ListVideoParams, "q" | "eventId">,
) {
  const searchFilter = buildPublicVideoSearchCondition(db, params.q);
  if (params.eventId) {
    return and(
      countablePublicVideoCondition,
      eventPublicVideoLinkCondition(params.eventId),
      searchFilter,
    )!;
  }
  return and(eq(videos.visibility_status, "public"), searchFilter)!;
}

/** 公開作品の汎用一覧取得。検索 / イベント絞り込み / ソート / ページング。 */
export async function fetchPublicVideos(db: DB, params: ListVideoParams) {
  const { sort = "new", limit = 24, offset = 0 } = params;
  const rows = await db
    .select(publicVideoListSelect)
    .from(videos)
    .leftJoin(events, eq(events.id, videos.primary_event_id))
    .where(publicVideoFilters(db, params))
    .orderBy(publicVideoOrderBy(sort))
    .limit(limit)
    .offset(offset);
  return resolveMissingIcons(db, uniqueBy(rows, (row) => row.id));
}

/**
 * 公開API向け。window countで一覧と総件数を同時取得する。
 * offsetが総件数を超えた空ページだけ、総数取得を1回追加する。
 */
export async function fetchPublicVideosPage(
  db: DB,
  params: ListVideoParams,
): Promise<{
  items: Awaited<ReturnType<typeof fetchPublicVideos>>;
  total: number;
}> {
  const { sort = "new", limit = 24, offset = 0 } = params;
  const pageRows = await db
    .select(publicVideoPageSelect)
    .from(videos)
    .leftJoin(events, eq(events.id, videos.primary_event_id))
    .where(publicVideoFilters(db, params))
    .orderBy(publicVideoOrderBy(sort))
    .limit(limit)
    .offset(offset);

  const total =
    pageRows.length > 0
      ? Number(pageRows[0]?.total_count ?? 0)
      : offset > 0
        ? await countPublicVideos(db, params)
        : 0;
  const rows = pageRows.map(({ total_count: _totalCount, ...row }) => row);
  return {
    items: await resolveMissingIcons(db, uniqueBy(rows, (row) => row.id)),
    total,
  };
}

/** 公開作品の単体取得。UUID / YouTube ID のどちらでも解決する。 */
export async function fetchPublicVideoByIdOrYoutube(
  db: DB,
  idOrYoutube: string,
) {
  const resolvedId = await resolveVideoPrimaryKey(db, idOrYoutube, {
    andWhere: eq(videos.visibility_status, "public"),
  });
  if (!resolvedId) return null;

  const rows = await db
    .select(publicVideoListSelect)
    .from(videos)
    .leftJoin(events, eq(events.id, videos.primary_event_id))
    .where(
      and(
        eq(videos.visibility_status, "public"),
        eq(videos.id, resolvedId),
      )!,
    )
    .limit(1);
  return (await resolveMissingIcons(db, rows))[0] ?? null;
}

/** 公開作品の総数。範囲外ページと一覧以外の呼び出し向け。 */
export async function countPublicVideos(db: DB, params: ListVideoParams) {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(videos)
    .where(publicVideoFilters(db, params));
  return Number(rows[0]?.c ?? 0);
}
