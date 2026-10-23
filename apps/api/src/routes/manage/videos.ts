import { Hono } from "hono";
import type { ManageVideoQueueRow, ManageVideosResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { finishReviewSummary, reviewSummarySql, type StageQuestion } from "../../lib/videoReviewSummaries.ts";
import { parseJsonColumn } from "../personal/context.ts";
import { canEditEvent, loadManageSnapshot, manageGate } from "./access.ts";

// CURRENT: app/(manage)/manage/events/[id]/videos/page.tsx + src/lib/admin/videoVisibilityLabels.ts.
// Authorization (CURRENT): admin or the event is in the caller's manageable ids, and the event exists (else 404);
// `canApproveVideoStatus` = video.status.
// D1 (S2, <= 3 statements incl. the session lookup): staff snapshot (admins skip it), then ONE statement: the event row,
// the pending count and the (<= 100) queue rows with their review-summary subqueries.
// CURRENT lists up to 200 rows; S2 caps a response at 100, so rows 101..200 are read with ?offset= (0..100, clamped).
const MAX_QUEUE_ROWS = 100;
const MAX_QUEUE_OFFSET = 100;

// CURRENT VIDEO_VISIBILITY_GROUPS / normalizeVideoVisibilityFilter / videoVisibilityFilterLabel.
const GROUPS = [
  { key: "review", label: "審査待ち", status: "pending" },
  { key: "public", label: "公開", status: "public" },
  { key: "private", label: "非公開", status: "private" },
  { key: "closed", label: "無効", status: "voided" },
] as const;
const STATUS_LABELS: Record<string, string> = { pending: "審査待ち", public: "公開", private: "非公開", voided: "無効化" };

function normalizeFilter(raw: string | undefined): string {
  const value = raw === undefined ? "review" : raw;
  if (!value || value === "all") return "";
  if (GROUPS.some((g) => g.key === value) || value in STATUS_LABELS) return value;
  return "review";
}

function statusForFilter(filter: string): string | null {
  if (!filter) return null;
  return GROUPS.find((g) => g.key === filter)?.status ?? (filter in STATUS_LABELS ? filter : null);
}

function groupForFilter(filter: string): string | null {
  if (GROUPS.some((g) => g.key === filter)) return filter;
  return GROUPS.find((g) => g.status === filter)?.key ?? null;
}

type RawRow = Omit<ManageVideoQueueRow, "stage_permission_summary" | "required_unanswered_count"> & {
  stage_questions: StageQuestion[] | null;
  required_missing: number | null;
};

export const manageVideosRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const eventId = c.req.param("id") ?? "";
  const statusFilter = normalizeFilter(c.req.query("status"));
  const offsetCandidate = Number(c.req.query("offset"));
  const offset = Number.isSafeInteger(offsetCandidate) && offsetCandidate > 0 ? Math.min(offsetCandidate, MAX_QUEUE_OFFSET) : 0;
  const db = c.env.DB;
  const snapshot = await loadManageSnapshot(db, user);
  const denied = manageGate(c, snapshot);
  if (denied) return denied;
  if (!snapshot.isAdmin && !snapshot.manageableEventIds.includes(eventId)) return c.json({ error: "Not Found" }, 404);

  const status = statusForFilter(statusFilter);
  const summary = reviewSummarySql("v.id", eventId);
  const row = await db
    .prepare(
      `SELECT e.id AS id, e.title AS title, e.accent_color AS accent_color,
         (SELECT COUNT(*) FROM video_events pe INNER JOIN videos pv ON pv.id = pe.video_id
           WHERE pe.event_id = ? AND pv.visibility_status = 'pending') AS pending_count,
         (SELECT json_group_array(json_object('id', q.id, 'title', q.title, 'source_type', q.source_type,
              'youtube_video_id', q.youtube_video_id, 'display_name', q.display_name, 'visibility_status', q.visibility_status,
              'created_at', q.created_at, 'stage_questions', json(q.stage_questions), 'required_missing', q.required_missing)) FROM (
            SELECT v.id AS id, v.title AS title, v.source_type AS source_type, v.youtube_video_id AS youtube_video_id,
              v.creator_display_name AS display_name, v.visibility_status AS visibility_status, v.created_at AS created_at,
              ${summary.sql}
            FROM videos v INNER JOIN video_events ve ON ve.video_id = v.id
            WHERE ve.event_id = ?${status ? " AND v.visibility_status = ?" : ""}
            ORDER BY v.created_at DESC, v.id DESC
            LIMIT ? OFFSET ?) q) AS queue
       FROM events e WHERE e.id = ? LIMIT 1`,
    )
    .bind(eventId, ...summary.params, eventId, ...(status ? [status] : []), MAX_QUEUE_ROWS, offset, eventId)
    .first<{ id: string; title: string; accent_color: string | null; pending_count: number; queue: string | null }>();
  if (!row) return c.json({ error: "Not Found" }, 404);

  const rows: ManageVideoQueueRow[] = parseJsonColumn<RawRow[]>(row.queue, []).map((r) => {
    const { stage_questions, required_missing, ...rest } = r;
    return { ...rest, ...finishReviewSummary({ stage_questions, required_missing }) };
  });
  const body: ManageVideosResponse = {
    isAdmin: snapshot.isAdmin,
    event: { id: row.id, title: row.title, accent_color: row.accent_color },
    pendingCount: Number(row.pending_count ?? 0),
    canApproveVideoStatus: canEditEvent(snapshot, eventId, "video.status"),
    statusFilter,
    filterLabel: statusFilter ? (GROUPS.find((g) => g.key === statusFilter)?.label ?? STATUS_LABELS[statusFilter] ?? statusFilter) : "すべて",
    isReviewFilter: groupForFilter(statusFilter) === "review",
    offset,
    pageSize: MAX_QUEUE_ROWS,
    rows,
  };
  return c.json(body);
});
