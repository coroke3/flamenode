/**
 * MIG-0643 U04, SA-106: queueYoutubeMetadataResync.
 * An isolated route, NOT mounted until MIG-0637 PR #472 releases
 * apps/api/src/routes/admin/index.ts and the remaining MIG-0643 units finish.
 * Parent admin router provides origin -> session -> writeGuard -> db.
 * CURRENT's best-effort immediate wake is intentionally zero in Hono (D-13-41);
 * sync-jobs cron drains pending D1 rows. No remote Queue binding used here.
 */
import { eq, and } from "drizzle-orm";
import { Hono } from "hono";
import { videos, videoYoutubeMetadata } from "@flamenode/db/schema";
import { AdminYoutubeResyncVideoIdSchema, type AdminYoutubeResyncResult } from "@flamenode/contracts";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
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

  // One combined read replaces the two CURRENT selects, preserving
  // the full metadata row (including its column order) for audit parity.
  // Together with writeGuard + CostGuard this stays within S3's three reads.
  let joined: Array<{ video: typeof videos.$inferSelect; metadata: typeof videoYoutubeMetadata.$inferSelect | null }>;
  try {
    joined = await db.select({ video: videos, metadata: videoYoutubeMetadata })
      .from(videos)
      .leftJoin(videoYoutubeMetadata, eq(videoYoutubeMetadata.video_id, videos.id))
      .where(eq(videos.id, videoId))
      .limit(1);
  } catch (error) {
    console.error("[youtube-sync-admin] preflight failed", error);
    const body: AdminYoutubeResyncResult = { ok: false, message: FAILURE };
    return c.json(body, 500);
  }
  if (!joined[0]) {
    const body: AdminYoutubeResyncResult = { ok: false, message: "作品が見つかりません。" };
    return c.json(body, 404);
  }
  const before = joined[0].metadata;
  if (before?.sync_status === "pending") {
    const body: AdminYoutubeResyncResult = { ok: true, already_pending: true };
    return c.json(body, 200);
  }

  const now = Math.max(Math.floor(Date.now() / 1000), (before?.updated_at ?? 0) + 1);
  const after: typeof videoYoutubeMetadata.$inferSelect = before
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
    ? db.update(videoYoutubeMetadata)
        .set({ sync_status: "pending", sync_error: null, synced_at: null, updated_at: now })
        .where(and(
          eq(videoYoutubeMetadata.video_id, videoId),
          expectedRowCondition({ expectedCurrent: { ...before } }),
        )!)
    : db.insert(videoYoutubeMetadata).values(after);

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
    console.error("[youtube-sync-admin] atomic mutation failed", error);
    const body: AdminYoutubeResyncResult = { ok: false, message: FAILURE };
    return c.json(body, error instanceof Error && /malformed JSON/i.test(error.message) ? 409 : 500);
  }

  // No revalidatePath in Hono, no immediate Queue wake (D-13-41).
  const body: AdminYoutubeResyncResult = { ok: true };
  return c.json(body, 200);
});
