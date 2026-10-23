import { Hono } from "hono";
import type {
  AdminXIdMergesResponse,
  AdminXMergeImpactItem,
  AdminXMergePreviewRow,
  AdminXMergeRequestRow,
  AdminXMergeRevertRow,
} from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";

// CURRENT: app/(admin)/admin/x-id-merges/page.tsx + src/lib/admin/xIdMergeImpact.ts (fetchXIdMergeImpact / Preview).
// D1: requests view 2 statements (+ session) without ?impact=, 3 with it (list; impact counts + preview in ONE union
// statement); reverts view 2. No try/catch in CURRENT -> D1 failure is 503. The restore JSON is never returned.
export const ADMIN_XMERGE_REQUESTS_LIMIT = 50;
export const ADMIN_XMERGE_REVERTS_LIMIT = 100;
export const ADMIN_XMERGE_PREVIEW_LIMIT = 51;

const IMPACT_SPECS = [
  ["videos.creator_x_user_id", "作品投稿者", "creatorVideos"],
  ["video_members.x_user_id", "合作メンバー", "members"],
  ["video_chapters.x_user_id", "チャプター", "chapters"],
  ["video_interactions.x_user_id", "いいね/保存", "interactions"],
  ["x_user_account_links.x_user_id", "認証ユーザー紐付け", "accountLinks"],
  ["event_staff.x_user_id", "イベントスタッフ", "staff"],
  ["x_user_aliases.x_user_id", "alias所有", "aliasesOwned"],
  ["x_user_aliases.alias_x_id", "alias参照", "aliasesPointing"],
  ["slots.x_user_id", "予約枠", "slotRows"],
  ["slot_reservation_groups.x_user_id", "連続枠グループ", "slotReservationGroups"],
  ["slots.reserved_x_id_snapshot", "予約主体スナップショット", "slotSnapshots"],
  ["video_moderation_cases.related_x_user_id", "審査・モデレーション案件", "moderationCases"],
  ["user.active_x_user_id", "利用中のActive X", "activeUsers"],
] as const;

const NORM_SNAPSHOT = (col: string) => `lower(trim(ltrim(trim(${col}), '@')))`;

/** Impact counts (one row) UNION ALL the preview rows (<= 51), padded to a common column list. */
function impactAndPreviewSql(): string {
  const impactCols = [
    "(SELECT COUNT(*) FROM videos WHERE creator_x_user_id = ?)",
    "(SELECT COUNT(*) FROM video_members WHERE x_user_id = ?)",
    "(SELECT COUNT(*) FROM video_chapters WHERE x_user_id = ?)",
    "(SELECT COUNT(*) FROM video_interactions WHERE x_user_id = ?)",
    "(SELECT COUNT(*) FROM x_user_account_links WHERE x_user_id = ?)",
    "(SELECT COUNT(*) FROM event_staff WHERE x_user_id = ?)",
    "(SELECT COUNT(*) FROM x_user_aliases WHERE x_user_id = ?)",
    "(SELECT COUNT(*) FROM x_user_aliases WHERE alias_x_id = ?)",
    "(SELECT COUNT(*) FROM slots WHERE x_user_id = ?)",
    "(SELECT COUNT(*) FROM slot_reservation_groups WHERE x_user_id = ?)",
    `(SELECT COUNT(*) FROM slots WHERE ${NORM_SNAPSHOT("reserved_x_id_snapshot")} = lower(?))`,
    "(SELECT COUNT(*) FROM video_moderation_cases WHERE related_x_user_id = ?)",
    `(SELECT COUNT(*) FROM "user" WHERE ${NORM_SNAPSHOT("active_x_user_id")} = lower(?))`,
  ];
  const impactSelect = `SELECT 'impact' AS kind, NULL AS id, NULL AS title, NULL AS visibility_status, NULL AS primary_event_id,
      NULL AS creator_change, NULL AS member_rows, NULL AS chapter_rows, NULL AS slot_rows, NULL AS interaction_rows,
      NULL AS moderation_rows, ${impactCols.map((c, i) => `${c} AS i${i}`).join(", ")}`;
  const nullImpact = impactCols.map((_, i) => `NULL AS i${i}`).join(", ");
  const preview = `SELECT 'preview' AS kind, p.id, p.title, p.visibility_status, p.primary_event_id, p.creator_change,
      p.member_rows, p.chapter_rows, p.slot_rows, p.interaction_rows, p.moderation_rows, ${nullImpact} FROM (
    WITH affected_video_ids(video_id, creator_change) AS (
      SELECT id, 1 FROM videos WHERE creator_x_user_id = ?
      UNION SELECT video_id, 0 FROM video_members WHERE x_user_id = ?
      UNION SELECT video_id, 0 FROM video_chapters WHERE x_user_id = ?
      UNION SELECT video_id, 0 FROM slots WHERE video_id IS NOT NULL
        AND (x_user_id = ? OR ${NORM_SNAPSHOT("reserved_x_id_snapshot")} = lower(?))
      UNION SELECT video_id, 0 FROM video_interactions WHERE x_user_id = ?
      UNION SELECT video_id, 0 FROM video_moderation_cases WHERE related_x_user_id = ?
    )
    SELECT v.id AS id, v.title AS title, v.visibility_status AS visibility_status, v.primary_event_id AS primary_event_id,
      MAX(affected_video_ids.creator_change) AS creator_change,
      (SELECT COUNT(*) FROM video_members vm WHERE vm.video_id = v.id AND vm.x_user_id = ?) AS member_rows,
      (SELECT COUNT(*) FROM video_chapters vc WHERE vc.video_id = v.id AND vc.x_user_id = ?) AS chapter_rows,
      (SELECT COUNT(*) FROM slots s WHERE s.video_id = v.id AND (s.x_user_id = ?
        OR ${NORM_SNAPSHOT("s.reserved_x_id_snapshot")} = lower(?))) AS slot_rows,
      (SELECT COUNT(*) FROM video_interactions vi WHERE vi.video_id = v.id AND vi.x_user_id = ?) AS interaction_rows,
      (SELECT COUNT(*) FROM video_moderation_cases vmc WHERE vmc.video_id = v.id AND vmc.related_x_user_id = ?) AS moderation_rows
    FROM affected_video_ids INNER JOIN videos v ON v.id = affected_video_ids.video_id
    GROUP BY v.id, v.title, v.visibility_status, v.primary_event_id
    ORDER BY v.title COLLATE NOCASE, v.id
    LIMIT ?) p`;
  return `${impactSelect} UNION ALL SELECT * FROM (${preview})`;
}
/** placeholders: 13 in the impact half, 7 (affected CTE) + 6 (per-video counts) = 13 in the preview half, then the LIMIT. */
const IMPACT_BINDS = 13;
const PREVIEW_BINDS = 13;

export const adminXIdMergesRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const view = c.req.query("view") === "reverts" ? "reverts" : "requests";
  const selectedImpactId = (c.req.query("impact") ?? "").trim().slice(0, 128);
  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);
  let requests: AdminXMergeRequestRow[] = [];
  let reverts: AdminXMergeRevertRow[] = [];

  if (view === "requests") {
    const { results } = await db
      .prepare(
        `SELECT r.id AS id, r.request_type AS request_type, r.status AS status, r.source_x_user_id AS source_x_user_id,
           r.target_x_user_id AS target_x_user_id, r.parent_request_id AS parent_request_id,
           r.revert_deadline_at AS revert_deadline_at, r.updated_at AS updated_at, s.x_name AS source_name,
           (SELECT t.x_name FROM x_users t WHERE t.id = r.target_x_user_id) AS target_name,
           CASE WHEN r.restore_snapshot_json IS NOT NULL AND r.restore_snapshot_json <> '' THEN 1 ELSE 0 END AS has_restore_snapshot
         FROM x_identity_requests r LEFT JOIN x_users s ON s.id = r.source_x_user_id
         WHERE r.request_type = 'merge' ORDER BY r.updated_at DESC LIMIT ?`,
      )
      .bind(ADMIN_XMERGE_REQUESTS_LIMIT)
      .all<Omit<AdminXMergeRequestRow, "impact" | "preview" | "has_restore_snapshot"> & { has_restore_snapshot: number }>();
    const selected = results.find(
      (row) =>
        row.id === selectedImpactId &&
        Boolean(row.source_x_user_id) &&
        (row.status === "pending" || row.status === "approved"),
    );
    let impact: AdminXMergeImpactItem[] = [];
    let preview: AdminXMergePreviewRow[] = [];
    if (selected?.source_x_user_id) {
      const source = selected.source_x_user_id;
      const rows = await db
        .prepare(impactAndPreviewSql())
        .bind(...Array(IMPACT_BINDS).fill(source), ...Array(PREVIEW_BINDS).fill(source), ADMIN_XMERGE_PREVIEW_LIMIT)
        .all<Record<string, unknown>>();
      for (const row of rows.results) {
        if (row.kind === "impact") {
          impact = IMPACT_SPECS.map(([key, label], i) => ({ key, label, count: Number(row[`i${i}`] ?? 0) }));
        } else {
          preview.push({
            id: String(row.id),
            title: String(row.title),
            visibility_status: String(row.visibility_status),
            primary_event_id: (row.primary_event_id as string | null) ?? null,
            creator_change: Number(row.creator_change ?? 0),
            member_rows: Number(row.member_rows ?? 0),
            chapter_rows: Number(row.chapter_rows ?? 0),
            slot_rows: Number(row.slot_rows ?? 0),
            interaction_rows: Number(row.interaction_rows ?? 0),
            moderation_rows: Number(row.moderation_rows ?? 0),
          });
        }
      }
    }
    requests = results.map((row) => ({
      ...row,
      has_restore_snapshot: row.has_restore_snapshot === 1,
      impact: row.id === selectedImpactId ? impact : [],
      preview: row.id === selectedImpactId ? preview : [],
    }));
  } else {
    const { results } = await db
      .prepare(
        `SELECT id, status, parent_request_id, revert_deadline_at,
           CASE WHEN restore_snapshot_json IS NOT NULL AND restore_snapshot_json <> '' THEN 1 ELSE 0 END AS has_restore_snapshot
         FROM x_identity_requests WHERE request_type = 'revert_merge' ORDER BY updated_at DESC LIMIT ?`,
      )
      .bind(ADMIN_XMERGE_REVERTS_LIMIT)
      .all<Omit<AdminXMergeRevertRow, "has_restore_snapshot"> & { has_restore_snapshot: number }>();
    reverts = results.map((row) => ({ ...row, has_restore_snapshot: row.has_restore_snapshot === 1 }));
  }

  const body: AdminXIdMergesResponse = { view, selectedImpactId, requests, reverts, now };
  return c.json(body);
});
