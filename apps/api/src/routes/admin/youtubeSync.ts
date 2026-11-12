/**
 * MIG-0643 U04, SA-106: queueYoutubeMetadataResync.
 * Mounted on the migration PR branch under /api/admin's
 * origin -> session -> writeGuard -> db chain, not production traffic.
 * CURRENT's best-effort immediate wake is intentionally zero in Hono
 * (D-13-41); sync-jobs cron drains pending D1 rows.
 * No remote Queue binding used here.
 */
import { Hono } from "hono";
import { AdminYoutubeResyncVideoIdSchema, type AdminYoutubeResyncResult } from "@flamenode/contracts/admin/staticRebuildOps";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { sql } from "@flamenode/server-core/sql";
import type { AppEnv } from "../../env.ts";
import { auditPreloaded } from "./body.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";

const FAILURE = "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。";

export const youtubeSyncAdminRoutes = new Hono<AppEnv>();
youtubeSyncAdminRoutes.use("*", onlyMutating(costGuardMiddleware("admin_youtube_sync")));

/** POST /api/admin/youtube-sync/videos/:videoId/resync */
youtubeSyncAdminRoutes.post("/videos/:videoId/resync", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const parsed = AdminYoutubeResyncVideoIdSchema.safeParse(c.req.param("videoId"));
  if (!parsed.success) {
    const body: AdminYoutubeResyncResult = { ok: false, message: "対象作品が不正です。" };
    return c.json(body, 400);
  }
  const videoId = parsed.data;
  const db = c.get("db");

  // A single bounded left join avoids a second D1 preflight read (S3).
  // This explicit SELECT column order mirrors Drizzle's CURRENT .select()
  // over videoYoutubeMetadata, used for audit before/after JSON parity.
  type MetadataRow = {
    video_id: string | null;
    youtube_privacy_status: string | null;
    youtube_availability_status: string | null;
    duration_seconds: number | null;
    view_count: number | null;
    synced_at: number | null;
    sync_status: "pending" | "synced" | "failed" | null;
    sync_error: string | null;
    updated_at: number | null;
  };
  type JoinedRow = MetadataRow & { found_video_id: string };
  let joined: JoinedRow | null;
  try {
    joined = await c.env.DB.prepare(`
      SELECT v.id AS found_video_id, m.video_id, m.youtube_privacy_status,
             m.youtube_availability_status, m.duration_seconds, m.view_count,
             m.synced_at, m.sync_status, m.sync_error, m.updated_at
      FROM videos AS v
      LEFT JOIN video_youtube_metadata AS m ON m.video_id = v.id
      WHERE v.id = ? LIMIT 1
    `).bind(videoId).first<JoinedRow>();
  } catch {
    // Provider failures can embed SQL/private bindings; never log their payload.
    console.error("[youtube-sync-admin] preflight failed (D1 unavailable)");
    const body: AdminYoutubeResyncResult = { ok: false, message: FAILURE };
    return c.json(body, 500);
  }
  if (!joined) {
    const body: AdminYoutubeResyncResult = { ok: false, message: "作品が見つかりません。" };
    return c.json(body, 404);
  }
  const before = joined.video_id
    ? {
        video_id: joined.video_id,
        youtube_privacy_status: joined.youtube_privacy_status,
        youtube_availability_status: joined.youtube_availability_status,
        duration_seconds: joined.duration_seconds,
        view_count: joined.view_count!,
        synced_at: joined.synced_at,
        sync_status: joined.sync_status!,
        sync_error: joined.sync_error,
        updated_at: joined.updated_at!,
      }
    : null;
  if (before?.sync_status === "pending") {
    const body: AdminYoutubeResyncResult = { ok: true, already_pending: true };
    return c.json(body, 200);
  }

  const now = Math.max(Math.floor(Date.now() / 1000), (before?.updated_at ?? 0) + 1);
  const after = before
    ? { ...before, sync_status: "pending", sync_error: null, synced_at: null, updated_at: now }
    : {
        video_id: videoId,
        youtube_privacy_status: null,
        youtube_availability_status: null,
        duration_seconds: null,
        view_count: 0,
        synced_at: null,
        sync_status: "pending",
        sync_error: null,
        updated_at: now,
      };
  const statement = before
    ? db.run(sql`
        UPDATE video_youtube_metadata
        SET sync_status = ${"pending"}, sync_error = NULL, synced_at = NULL, updated_at = ${now}
        WHERE video_id = ${videoId} AND (${expectedRowCondition({ expectedCurrent: { ...before } })})
      `)
    : db.run(sql`
        INSERT INTO video_youtube_metadata (
          video_id, youtube_privacy_status, youtube_availability_status,
          duration_seconds, view_count, synced_at, sync_status, sync_error, updated_at
        ) VALUES (${videoId}, NULL, NULL, NULL, ${0}, NULL, ${"pending"}, NULL, ${now})
      `);

  try {
    await mutateWithAudit(db, {
      mutationStatements: [statement],
      expectedMutationChanges: 1,
      preloaded: auditPreloaded(c),
      audits: [{
        table_name: "video_youtube_metadata",
        target_id: videoId,
        operation: before ? "UPDATE" : "CREATE",
        before: before ? { ...before } : null,
        after: { ...after },
        actor_user_id: c.get("user")!.id,
        context: "admin_youtube_sync",
        reason: "YouTubeメタデータ再同期を予約",
        retention_class: "normal",
        strict: true,
      }],
    });
  } catch (error) {
    // Keep exception details out of logs; inspect only the local conflict category.
    console.error("[youtube-sync-admin] atomic mutation failed (D1/audit unavailable)");
    const body: AdminYoutubeResyncResult = { ok: false, message: FAILURE };
    return c.json(body, error instanceof Error && /malformed JSON/i.test(error.message) ? 409 : 500);
  }

  // No revalidatePath in Hono, no immediate Queue wake (D-13-41).
  const body: AdminYoutubeResyncResult = { ok: true };
  return c.json(body, 200);
});
