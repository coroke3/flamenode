import { Hono } from "hono";
import type { DashboardResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { approvedXIdsOf, computeOnboardingState, loadPersonalContext, parseJsonColumn } from "./context.ts";
import {
  approvedXIdsWhere,
  CARD_COLUMNS,
  CHAPTER_COLUMNS,
  jsonList,
  jsonRow,
  collabVideosStatement,
  DASHBOARD_COLLAB_DISPLAY,
  EXCLUDE_PVSF_SUMMARY_VIDEOS_SQL,
  myChaptersStatement,
  myVideosStatement,
  toChapterItem,
  toVideoCard,
  type ChapterRow,
  type SqlFragment,
  type VideoCardRow,
} from "./sql.ts";

// CURRENT: app/(auth)/dashboard/page.tsx.
// D1 (S2, <= 3 statements incl. the session lookup): context = 1 statement (terms + linked X + pending request),
// then ONE statement whose columns are bounded JSON subqueries (own videos / collab / chapters / active slot / stats).
export const DASHBOARD_PREVIEW_LIMIT = 8;
const SLOT_COLUMNS = ["id", "status", "start_time", "slot_label", "video_id", "event_id", "event_title", "event_accent_color"] as const;

interface SlotRow {
  id: string;
  status: "reserved" | "submitted";
  start_time: number | null;
  slot_label: string | null;
  video_id: string | null;
  event_id: string | null;
  event_title: string | null;
  event_accent_color: string | null;
}

function activeSlotStatement(authUserId: string, activeX: string | null): SqlFragment {
  const owner = activeX
    ? { sql: "s.reserved_by_user_id = ? AND (s.x_user_id = ? OR s.x_user_id IS NULL)", params: [authUserId, activeX] }
    : { sql: "s.x_user_id IS NULL AND s.reserved_by_user_id = ?", params: [authUserId] };
  return {
    sql: `SELECT s.id AS id, s.status AS status, s.start_time AS start_time, s.slot_label AS slot_label,
        s.video_id AS video_id, e.id AS event_id, e.title AS event_title, e.accent_color AS event_accent_color
      FROM slots s
      LEFT JOIN events e ON e.id = s.event_id
      WHERE ${owner.sql} AND (s.status = 'reserved' OR s.status = 'submitted')
      ORDER BY CASE WHEN s.start_time IS NULL THEN 1 ELSE 0 END, s.start_time ASC, s.sort_order ASC, s.id ASC
      LIMIT 1`,
    params: owner.params,
  };
}

function statsStatements(approvedXIds: readonly string[]): [SqlFragment, SqlFragment] {
  const creator = approvedXIdsWhere("videos.creator_x_user_id", approvedXIds);
  const videoWhere = `${creator.sql} AND videos.visibility_status <> 'voided' AND ${EXCLUDE_PVSF_SUMMARY_VIDEOS_SQL}`;
  return [
    {
      sql: `SELECT COALESCE(SUM(videos.app_like_count), 0) AS likes,
          COALESCE(SUM(video_youtube_metadata.view_count), 0) AS views,
          COUNT(*) AS c
        FROM videos
        LEFT JOIN video_youtube_metadata ON video_youtube_metadata.video_id = videos.id
        WHERE ${videoWhere}`,
      params: creator.params,
    },
    {
      sql: `SELECT COUNT(*) AS event_count FROM (
          SELECT videos.primary_event_id AS event_id
          FROM videos
          WHERE ${videoWhere}
            AND videos.primary_event_id IS NOT NULL AND videos.primary_event_id <> ''
          UNION
          SELECT video_events.event_id AS event_id
          FROM video_events
          INNER JOIN videos ON videos.id = video_events.video_id
          WHERE ${videoWhere}
            AND video_events.event_id IS NOT NULL AND video_events.event_id <> ''
        ) AS dashboard_event_ids`,
      params: [...creator.params, ...creator.params],
    },
  ];
}

export const personalDashboardRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;
  const ctx = await loadPersonalContext(db, sessionUser, { pendingRequest: true });
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const { user, linkedRows } = ctx;
  const onboarding = computeOnboardingState({
    user,
    linkedRows,
    pendingRequest: ctx.pendingRequest,
  });
  const approvedXIds = approvedXIdsOf(linkedRows);

  // One statement: every section is a bounded JSON subquery. CURRENT wraps these reads in a try/catch
  // that logs and renders the empty sections, so a failure here returns the same empty data (200).
  const limit = DASHBOARD_PREVIEW_LIMIT + 1;
  const parts: Record<string, SqlFragment | null> = {
    mine:
      approvedXIds.length > 0 && onboarding.activeApprovedXId
        ? jsonList(myVideosStatement(onboarding.activeApprovedXId, limit, 0), CARD_COLUMNS)
        : null,
    collab:
      approvedXIds.length > 0
        ? jsonList(collabVideosStatement(approvedXIds, DASHBOARD_COLLAB_DISPLAY, limit, 0), CARD_COLUMNS)
        : null,
    chapters:
      approvedXIds.length > 0 ? jsonList(myChaptersStatement(approvedXIds, limit, 0), CHAPTER_COLUMNS) : null,
    slot: jsonRow(activeSlotStatement(user.id, user.active_x_user_id), SLOT_COLUMNS),
    agg: null,
    events: null,
  };
  if (approvedXIds.length > 0) {
    const [agg, events] = statsStatements(approvedXIds);
    parts.agg = jsonRow(agg, ["likes", "views", "c"]);
    parts.events = { sql: `(SELECT q.event_count FROM (${events.sql}) q)`, params: events.params };
  }

  let sections: Record<string, unknown> = {};
  try {
    const keys = Object.keys(parts);
    const row = await db
      .prepare(`SELECT ${keys.map((key) => `${parts[key]?.sql ?? "NULL"} AS ${key}`).join(", ")}`)
      .bind(...keys.flatMap((key) => parts[key]?.params ?? []))
      .first<Record<string, unknown>>();
    sections = row ?? {};
    for (const key of ["mine", "collab", "chapters", "slot", "agg"]) {
      sections[key] = parseJsonColumn<unknown>(sections[key], null);
    }
  } catch {
    console.error("[personal] DASHBOARD_SECTIONS_FAILED");
    sections = {};
  }

  const mineRows = (sections.mine ?? []) as VideoCardRow[];
  const collabRows = (sections.collab ?? []) as VideoCardRow[];
  const chapterRows = (sections.chapters ?? []) as ChapterRow[];
  const slot = (sections.slot ?? undefined) as SlotRow | undefined;
  const agg = (sections.agg ?? undefined) as { likes?: unknown; views?: unknown; c?: unknown } | undefined;
  const eventCount = { event_count: sections.events };

  const body: DashboardResponse = {
    user,
    onboarding,
    linkedXUsers: linkedRows.map((row) => ({
      id: row.x_user_id,
      x_name: row.x_name,
      icon_url: row.icon_url ?? null,
      approval_status:
        row.approval_status === "pending" ||
        row.approval_status === "approved" ||
        row.approval_status === "rejected" ||
        row.approval_status === "imported"
          ? row.approval_status
          : null,
    })),
    myVideos: {
      items: mineRows.slice(0, DASHBOARD_PREVIEW_LIMIT).map(toVideoCard),
      hasMore: mineRows.length > DASHBOARD_PREVIEW_LIMIT,
    },
    collabVideos: {
      items: collabRows.slice(0, DASHBOARD_PREVIEW_LIMIT).map(toVideoCard),
      hasMore: collabRows.length > DASHBOARD_PREVIEW_LIMIT,
    },
    myChapters: {
      items: chapterRows.slice(0, DASHBOARD_PREVIEW_LIMIT).map(toChapterItem),
      hasMore: chapterRows.length > DASHBOARD_PREVIEW_LIMIT,
    },
    // CURRENT shows the empty hero card when the slot's event row is missing.
    activeSlot:
      slot && slot.event_id && slot.event_title != null
        ? {
            slot: {
              id: slot.id,
              status: slot.status,
              start_time: slot.start_time ?? null,
              slot_label: slot.slot_label ?? null,
              video_id: slot.video_id ?? null,
            },
            event: {
              id: slot.event_id,
              title: slot.event_title,
              accent_color: slot.event_accent_color ?? null,
            },
          }
        : null,
    stats: {
      likes: Number(agg?.likes ?? 0),
      views: Number(agg?.views ?? 0),
      video_count: Number(agg?.c ?? 0),
      event_count: Number(eventCount?.event_count ?? 0),
    },
  };
  return c.json(body);
});
