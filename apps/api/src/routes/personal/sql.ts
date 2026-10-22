// MIG-0611: raw SQL building blocks shared by the Personal read routes.
// Every query that uses these is bounded by a named LIMIT in its caller.

/** Max linked X IDs read per user (a user links a handful; this is only a safety cap, CURRENT is unbounded). */
export const MAX_LINKED_X_USERS = 200;

export const PVSF_SUMMARY_EVENT_ID = "PVSFSummary";

function uniqueXIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
}

export interface SqlFragment {
  sql: string;
  params: unknown[];
}

/**
 * CURRENT approvedXIdsWhere (src/lib/auth/approvedXPredicate.ts). CURRENT binds one parameter per ID up to
 * 80 and switches to json_each above that; this always uses json_each (one bind), which returns the same
 * rows and keeps statements that repeat the predicate under D1's 100-bind limit.
 */
export function approvedXIdsWhere(column: string, ids: readonly string[]): SqlFragment {
  const unique = uniqueXIds(ids);
  if (unique.length === 0) return { sql: "0 = 1", params: [] };
  return {
    sql: `${column} IN (SELECT CAST(value AS TEXT) FROM json_each(?) WHERE value IS NOT NULL)`,
    params: [JSON.stringify(unique)],
  };
}

/** CURRENT approvedXIdsNotWhere. NULL columns are excluded (callers OR it with `IS NULL`). */
export function approvedXIdsNotWhere(column: string, ids: readonly string[]): SqlFragment {
  const unique = uniqueXIds(ids);
  if (unique.length === 0) return { sql: "1 = 1", params: [] };
  return {
    sql: `${column} IS NOT NULL AND ${column} NOT IN (SELECT CAST(value AS TEXT) FROM json_each(?) WHERE value IS NOT NULL)`,
    params: [JSON.stringify(unique)],
  };
}

/** CURRENT excludePvsfSummaryVideos() on the unaliased `videos` table. */
export const EXCLUDE_PVSF_SUMMARY_VIDEOS_SQL = `COALESCE(videos.primary_event_id, '') <> '${PVSF_SUMMARY_EVENT_ID}'
    AND NOT EXISTS (
      SELECT 1 FROM video_events AS pvsf_summary_video_events
      WHERE pvsf_summary_video_events.video_id = videos.id
        AND pvsf_summary_video_events.event_id = '${PVSF_SUMMARY_EVENT_ID}'
    )`;

export const CARD_COLUMNS = [
  "id",
  "title",
  "youtube_video_id",
  "display_name",
  "icon_url",
  "creator_x_user_id",
  "primary_event_id",
  "scheduled_time",
  "status",
] as const;

export const CHAPTER_COLUMNS = [
  "id",
  "video_id",
  "youtube_video_id",
  "video_title",
  "chapter_time",
  "chapter_label",
  "visibility",
  "created_at",
] as const;

const jsonColumns = (columns: readonly string[]) => columns.map((c) => `'${c}', q.${c}`).join(", ");

/**
 * Wraps a bounded, ordered list query as ONE scalar JSON array column (D1 statement consolidation,
 * ZERO_1102 S2). Row order is the inner ORDER BY; the inner query keeps its own LIMIT.
 */
export function jsonList(fragment: SqlFragment, columns: readonly string[]): SqlFragment {
  return {
    sql: `(SELECT json_group_array(json_object(${jsonColumns(columns)})) FROM (${fragment.sql}) q)`,
    params: fragment.params,
  };
}

/** Wraps a single-row query as one scalar JSON object column (NULL when there is no row). */
export function jsonRow(fragment: SqlFragment, columns: readonly string[]): SqlFragment {
  return {
    sql: `(SELECT json_object(${jsonColumns(columns)}) FROM (${fragment.sql}) q)`,
    params: fragment.params,
  };
}

export interface VideoCardRow {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string | null;
  icon_url: string | null;
  creator_x_user_id: string | null;
  primary_event_id: string | null;
  scheduled_time: number | null;
  status: string | null;
}

export interface ChapterRow {
  id: string;
  video_id: string;
  youtube_video_id: string | null;
  video_title: string | null;
  chapter_time: number;
  chapter_label: string;
  visibility: "private" | "public" | null;
  created_at: number;
}

export function toVideoCard(row: VideoCardRow) {
  return {
    id: row.id,
    title: row.title,
    youtube_video_id: row.youtube_video_id ?? null,
    display_name: row.display_name ?? "",
    icon_url: row.icon_url ?? null,
    creator_x_user_id: row.creator_x_user_id ?? null,
    primary_event_id: row.primary_event_id ?? null,
    scheduled_time: row.scheduled_time ?? null,
    status: row.status ?? null,
  };
}

export function toChapterItem(row: ChapterRow) {
  return {
    id: row.id,
    video_id: row.video_id,
    youtube_video_id: row.youtube_video_id ?? null,
    video_title: row.video_title ?? null,
    chapter_time: Number(row.chapter_time),
    chapter_label: row.chapter_label,
    visibility: row.visibility ?? null,
    created_at: Number(row.created_at),
  };
}

/**
 * Own video cards by creator X ID (dashboard "my videos" and library "mine"; CURRENT selects the
 * creator_* snapshot columns as they are).
 */
export function myVideosStatement(xUserId: string, limit: number, offset: number): SqlFragment {
  return {
    sql: `SELECT id, title, youtube_video_id,
        creator_display_name AS display_name,
        creator_icon_url AS icon_url,
        creator_x_user_id, primary_event_id, scheduled_time,
        visibility_status AS status
      FROM videos
      WHERE creator_x_user_id = ? AND visibility_status <> 'voided'
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    params: [xUserId, limit, offset],
  };
}

/**
 * Videos the approved X IDs can edit but did not create. `displayExpr` differs between the dashboard
 * (COALESCE with x_users) and the library (creatorNameExpr), exactly as in CURRENT.
 */
export function collabVideosStatement(
  approvedXIds: readonly string[],
  display: { name: string; icon: string },
  limit: number,
  offset: number,
): SqlFragment {
  const member = approvedXIdsWhere("video_members.x_user_id", approvedXIds);
  const notCreator = approvedXIdsNotWhere("videos.creator_x_user_id", approvedXIds);
  return {
    sql: `SELECT DISTINCT videos.id AS id, videos.title AS title, videos.youtube_video_id AS youtube_video_id,
        ${display.name} AS display_name,
        ${display.icon} AS icon_url,
        videos.creator_x_user_id AS creator_x_user_id,
        videos.primary_event_id AS primary_event_id,
        videos.scheduled_time AS scheduled_time,
        videos.visibility_status AS status
      FROM video_members
      INNER JOIN videos ON videos.id = video_members.video_id
      LEFT JOIN x_users ON x_users.id = videos.creator_x_user_id
      WHERE ${member.sql}
        AND video_members.can_edit = 1
        AND videos.visibility_status <> 'voided'
        AND (videos.creator_x_user_id IS NULL OR ${notCreator.sql})
      ORDER BY videos.created_at DESC, videos.id DESC
      LIMIT ? OFFSET ?`,
    params: [...member.params, ...notCreator.params, limit, offset],
  };
}

export const DASHBOARD_COLLAB_DISPLAY = {
  name: "COALESCE(videos.creator_display_name, x_users.x_name, '@' || videos.creator_x_user_id)",
  icon: "COALESCE(videos.creator_icon_url, x_users.icon_url)",
} as const;

export const LIBRARY_COLLAB_DISPLAY = {
  name: "COALESCE(NULLIF(TRIM(videos.creator_display_name), ''), videos.creator_x_user_id, '')",
  icon: "videos.creator_icon_url",
} as const;

/** Chapter comments written under any of the approved X IDs. */
export function myChaptersStatement(
  approvedXIds: readonly string[],
  limit: number,
  offset: number,
): SqlFragment {
  const owner = approvedXIdsWhere("video_chapters.x_user_id", approvedXIds);
  return {
    sql: `SELECT video_chapters.id AS id, video_chapters.video_id AS video_id,
        videos.youtube_video_id AS youtube_video_id, videos.title AS video_title,
        video_chapters.chapter_time AS chapter_time, video_chapters.chapter_label AS chapter_label,
        video_chapters.visibility AS visibility, video_chapters.created_at AS created_at
      FROM video_chapters
      LEFT JOIN videos ON videos.id = video_chapters.video_id
      WHERE ${owner.sql}
      ORDER BY video_chapters.created_at DESC, video_chapters.id DESC
      LIMIT ? OFFSET ?`,
    params: [...owner.params, limit, offset],
  };
}
