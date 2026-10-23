import { Hono } from "hono";
import type { AdminVideoRow, AdminVideosResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { finishReviewSummary, reviewSummarySql, type ReviewSummaryRow } from "../../lib/videoReviewSummaries.ts";
import { parseJsonColumn } from "../personal/context.ts";
import {
  ADMIN_EVENT_OPTIONS_LIMIT,
  ADMIN_VIDEOS_PAGE_SIZE,
  clampPage,
  escapeLike,
} from "./shared.ts";

// CURRENT: app/(admin)/admin/videos/page.tsx (+ src/lib/admin/videoVisibilityLabels.ts, videoReviewQueueOrder.ts).
// D1 (S2, 2 statements + the session lookup = 3): (1) total + page rows as one JSON-column row, (2) event options.
// CURRENT wraps the reads in try/catch and renders the empty page, so a D1 failure is 200 + degraded.
// DIVERGENCE: event options LIMIT 200 -> 100 (ZERO_1102 S2 named LIMIT <= 100); see the MIG-0625 work item.
// Review group (status review|pending, CURRENT useReviewTable): fetchVideoReviewSummaries via apps/api/src/lib/videoReviewSummaries.ts
// (MIG-0624 / PR #345, copied verbatim) as correlated subqueries of the page statement; >4 stage questions -> 503 like CURRENT.
const GROUPS: Record<string, readonly string[]> = {
  review: ["pending"],
  public: ["public"],
  private: ["private"],
  closed: ["voided"],
};
const STATUSES = new Set(["pending", "public", "private", "voided"]);
const VIDEO_COLUMNS = ["id", "title", "source_type", "youtube_video_id", "display_name", "status", "created_at"] as const;

/** CURRENT normalizeVideoVisibilityFilter + videoVisibilityStatusesForFilter. */
function normalizeStatus(raw: string | undefined): string {
  if (!raw || raw === "all") return "";
  return Object.hasOwn(GROUPS, raw) || STATUSES.has(raw) ? raw : "";
}

export const adminVideosRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const q = c.req.query("q") ?? "";
  const status = normalizeStatus(c.req.query("status"));
  const event = c.req.query("event") ?? "";
  const { page, pageSize, offset } = clampPage(c.req.query("page") || "1", ADMIN_VIDEOS_PAGE_SIZE);

  const joins: string[] = [];
  const conds: string[] = [];
  const params: unknown[] = [];
  if (q) {
    const term = `%${escapeLike(q)}%`;
    joins.push("LEFT JOIN x_users ON x_users.id = videos.creator_x_user_id");
    conds.push(
      "(videos.title LIKE ? OR videos.creator_display_name LIKE ? OR videos.creator_x_user_id LIKE ? OR x_users.x_name LIKE ? OR x_users.id LIKE ?)",
    );
    params.push(term, term, term, term, term);
  }
  const statuses = status ? (Object.hasOwn(GROUPS, status) ? GROUPS[status]! : [status]) : null;
  if (statuses) {
    conds.push(`videos.visibility_status IN (${statuses.map(() => "?").join(", ")})`);
    params.push(...statuses);
  }
  if (event) {
    joins.push("INNER JOIN video_events ON video_events.video_id = videos.id");
    conds.push("video_events.event_id = ?");
    params.push(event);
  }
  const from = `FROM videos ${joins.join(" ")} ${conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : ""}`;
  const columns = VIDEO_COLUMNS.map((name) => `'${name}', r.${name}`).join(", ");

  const useReview = status === "review" || status === "pending";
  const review = useReview ? reviewSummarySql("videos.id", event || undefined) : null;
  const reviewColumns = review ? ", 'stage_questions', json(r.stage_questions), 'required_missing', r.required_missing" : "";

  const db = c.env.DB;
  let videos: (AdminVideoRow & Partial<ReviewSummaryRow>)[] = [];
  let events: { id: string; title: string }[] = [];
  let total = 0;
  let degraded = false;
  try {
    const pageStatement = db
      .prepare(
        `SELECT (SELECT COUNT(*) ${from}) AS total,
           (SELECT json_group_array(json_object(${columns}${reviewColumns})) FROM (
              SELECT videos.id AS id, videos.title AS title, videos.source_type AS source_type,
                videos.youtube_video_id AS youtube_video_id, videos.creator_display_name AS display_name,
                videos.visibility_status AS status, videos.created_at AS created_at${review ? `, ${review.sql}` : ""}
              ${from}
              ORDER BY videos.created_at DESC, videos.id DESC
              LIMIT ? OFFSET ?) r) AS rows`,
      )
      .bind(...params, ...(review?.params ?? []), ...params, pageSize, offset);
    const eventsStatement = db
      .prepare(
        `SELECT id, title FROM events WHERE visibility_status = 'public' ORDER BY start_time DESC LIMIT ?`,
      )
      .bind(ADMIN_EVENT_OPTIONS_LIMIT);
    const [pageRow, eventRows] = await Promise.all([
      pageStatement.first<{ total: number; rows: string | null }>(),
      eventsStatement.all<{ id: string; title: string }>(),
    ]);
    videos = parseJsonColumn<(AdminVideoRow & Partial<ReviewSummaryRow>)[]>(pageRow?.rows, []);
    total = Number(pageRow?.total ?? 0);
    events = eventRows.results;
  } catch {
    console.error("[adminRead:videos] READ_FAILED");
    degraded = true;
  }

  // CURRENT computes the summaries outside its try/catch: a failure here is the error page (503).
  const outRows: AdminVideoRow[] = videos.map((row) => {
    const { stage_questions, required_missing, ...rest } = row;
    return useReview ? { ...rest, review: finishReviewSummary({ stage_questions: stage_questions ?? null, required_missing: required_missing ?? null }) } : rest;
  });

  const body: AdminVideosResponse = {
    q,
    status,
    event,
    paging: { page, pageSize, total },
    videos: outRows,
    events,
    reviewSummaries: useReview ? "included" : "not_requested",
    degraded,
  };
  return c.json(body);
});
