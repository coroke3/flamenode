import { Hono } from "hono";
import type { LibraryResponse, LibraryTab } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { activeApprovedXId, approvedXIdsOf, resolveActiveXUserId, linkedXStatement, type LinkedXRow } from "./context.ts";
import {
  collabVideosStatement,
  LIBRARY_COLLAB_DISPLAY,
  myChaptersStatement,
  myVideosStatement,
  toChapterItem,
  toVideoCard,
  type ChapterRow,
  type VideoCardRow,
} from "./sql.ts";

// CURRENT: app/(auth)/dashboard/library/page.tsx.
// D1: like/bookmark = 1 batch of 2 statements; mine/collab/chapters = linked X read, then 1 list statement.
export const DASHBOARD_LIBRARY_PAGE_SIZE = 24;
export const DASHBOARD_LIBRARY_MAX_PAGE = 500;

export function parseLibraryTab(rawTab: string | undefined): LibraryTab {
  if (rawTab === "bookmark" || rawTab === "mine" || rawTab === "collab" || rawTab === "chapters") {
    return rawTab;
  }
  return "like";
}

export function parseLibraryPage(rawPage: string | undefined): number {
  const candidate = Number(rawPage);
  if (!Number.isSafeInteger(candidate) || candidate < 1) return 1;
  return Math.min(candidate, DASHBOARD_LIBRARY_MAX_PAGE);
}

export const personalLibraryRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;
  const tab = parseLibraryTab(c.req.query("tab"));
  const page = parseLibraryPage(c.req.query("page"));
  const offset = (page - 1) * DASHBOARD_LIBRARY_PAGE_SIZE;
  const limit = DASHBOARD_LIBRARY_PAGE_SIZE + 1;

  let videos: VideoCardRow[] = [];
  let chapters: ChapterRow[] = [];
  let hasOtherTabHits = false;
  let activeApproved: string | null = null;
  let approvedXIdCount = 0;

  if (tab === "like" || tab === "bookmark") {
    const otherTab = tab === "like" ? "bookmark" : "like";
    const [otherResult, listResult] = await db.batch([
      db
        .prepare(
          "SELECT video_id FROM video_interactions_auth WHERE auth_user_id = ? AND interaction_type = ? LIMIT 1",
        )
        .bind(sessionUser.id, otherTab),
      db
        .prepare(
          `SELECT videos.id AS id, videos.title AS title, videos.youtube_video_id AS youtube_video_id,
             COALESCE(NULLIF(TRIM(videos.creator_display_name), ''), videos.creator_x_user_id, '') AS display_name,
             videos.creator_icon_url AS icon_url,
             videos.creator_x_user_id AS creator_x_user_id,
             videos.primary_event_id AS primary_event_id,
             videos.scheduled_time AS scheduled_time,
             videos.visibility_status AS status
           FROM video_interactions_auth
           INNER JOIN videos ON videos.id = video_interactions_auth.video_id
           WHERE video_interactions_auth.auth_user_id = ?
             AND video_interactions_auth.interaction_type = ?
             AND videos.visibility_status = 'public'
           ORDER BY videos.scheduled_time DESC, videos.id DESC
           LIMIT ? OFFSET ?`,
        )
        .bind(sessionUser.id, tab, limit, offset),
    ]);
    hasOtherTabHits = (otherResult?.results.length ?? 0) > 0;
    videos = (listResult?.results ?? []) as unknown as VideoCardRow[];
  } else {
    const linked = await linkedXStatement(db, sessionUser.id).all<LinkedXRow>();
    const linkedRows = linked.results;
    let statement: { sql: string; params: unknown[] } | null = null;
    if (tab === "mine") {
      const active = resolveActiveXUserId(sessionUser.active_x_user_id, linkedRows);
      activeApproved = activeApprovedXId(active, linkedRows);
      if (activeApproved) statement = myVideosStatement(activeApproved, limit, offset);
    } else {
      const approvedXIds = approvedXIdsOf(linkedRows);
      approvedXIdCount = approvedXIds.length;
      if (approvedXIds.length > 0) {
        statement =
          tab === "collab"
            ? collabVideosStatement(approvedXIds, LIBRARY_COLLAB_DISPLAY, limit, offset)
            : myChaptersStatement(approvedXIds, limit, offset);
      }
    }
    if (statement) {
      const { results } = await db
        .prepare(statement.sql)
        .bind(...statement.params)
        .all();
      if (tab === "chapters") chapters = results as unknown as ChapterRow[];
      else videos = results as unknown as VideoCardRow[];
    }
  }

  const listed = tab === "chapters" ? chapters : videos;
  const hasNextPage = page < DASHBOARD_LIBRARY_MAX_PAGE && listed.length > DASHBOARD_LIBRARY_PAGE_SIZE;
  const body: LibraryResponse = {
    tab,
    page,
    pageSize: DASHBOARD_LIBRARY_PAGE_SIZE,
    hasNextPage,
    hasOtherTabHits,
    activeApprovedXId: activeApproved,
    approvedXIdCount,
    videos: videos.slice(0, DASHBOARD_LIBRARY_PAGE_SIZE).map(toVideoCard),
    chapters: chapters.slice(0, DASHBOARD_LIBRARY_PAGE_SIZE).map(toChapterItem),
  };
  return c.json(body);
});
