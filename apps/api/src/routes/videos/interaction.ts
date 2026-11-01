/**
 * MIG-0640 (SA-087): authenticated like/bookmark toggle.
 * CURRENT src/lib/actions/video/interaction.ts is retained as rollback.
 *
 * Guard: any logged-in auth user (active X is NOT required), TOS and
 * CostGuard like_or_bookmark, all enforced by videoWriteStack.
 * D-13-45: one video + interaction SELECT after the two guard reads.
 * All mutation/audit/queue writes are one D1 batch, no request-time wake
 * (DOCUMENTED DIFFERENCE D-0603-1).
 */
import { VideoInteractionBodySchema, type VideoInteractionResult } from "@flamenode/contracts";
import { nextVideoAppLikeCount } from "@flamenode/domain/video";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import type { WriteAuditLogInput } from "@flamenode/server-core/audit/types";
import { sql } from "@flamenode/server-core/sql";
import { buildStaticRebuildQueueBatch } from "@flamenode/server-core/staticRebuild/enqueue";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../env.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../admin/body.ts";

const CONFLICT_MESSAGE =
  "操作が競合したか、保存に失敗しました。再読み込みして再試行してください。";

type VideoRow = {
  id: string;
  youtube_video_id: string | null;
  visibility_status: string;
  updated_at: number;
  app_like_count: number;
  [column: string]: unknown;
};
type Snapshot = { video: VideoRow; interaction: {
  auth_user_id: string; video_id: string; interaction_type: "like" | "bookmark"; created_at: number;
} | null };

function fail(c: Context<AppEnv>, message: string, status: 400 | 403 | 404 | 409 | 413 | 503) {
  const result: VideoInteractionResult = { ok: false, message };
  return c.json(result, status);
}

function isUniqueConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message) && /video_interactions_auth/i.test(message);
}

/**
 * Keep CURRENT Drizzle's logical column order when serializing strict audit
 * before/after JSON. SQLite migrations can append columns physically at the end,
 * so SELECT v.* changes audit bytes even when the row values are identical.
 */
export const VIDEO_SNAPSHOT_COLUMNS = [
  "id",
  "primary_event_id",
  "creator_x_user_id",
  "submitted_by_user_id",
  "collaboration_type",
  "part",
  "source_type",
  "creator_display_name",
  "creator_display_name_yomi",
  "creator_icon_url",
  "creator_youtube_channel_url",
  "creator_profile_text",
  "creator_other_social_links",
  "title",
  "music",
  "credit",
  "music_reference_url",
  "closing_comment",
  "youtube_video_id",
  "intro_comment",
  "highlights",
  "production_story",
  "visibility_status",
  "scheduling_type",
  "scheduled_time",
  "app_like_count",
  "score",
  "score_updated_at",
  "created_at",
  "updated_at",
] as const;


async function loadSnapshot(db: D1Database, videoId: string, userId: string, kind: "like" | "bookmark"): Promise<Snapshot | null> {
  const row = await db.prepare(`
    SELECT ${VIDEO_SNAPSHOT_COLUMNS.map((column) => `v."${column}" AS "${column}"`).join(", ")}, (
      SELECT i.created_at FROM video_interactions_auth i
      WHERE i.auth_user_id = ? AND i.video_id = v.id AND i.interaction_type = ?
      LIMIT 1
    ) AS __interaction_created_at
    FROM videos v WHERE v.id = ? LIMIT 1
  `).bind(userId, kind, videoId).first<VideoRow & { __interaction_created_at: number | null }>();
  if (!row) return null;
  const { __interaction_created_at: createdAt, ...video } = row;
  const interaction = createdAt === null
    ? null
    : { auth_user_id: userId, video_id: videoId, interaction_type: kind, created_at: createdAt };
  return { video, interaction };
}

function auditTargetId(...parts: string[]): string {
  // Identical to CURRENT compositeAuditTargetId without importing a Next-bound module.
  return parts.map((part) => encodeURIComponent(part)).join(":");
}

export function createVideoInteractionRoutes(guard: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post("/:videoId/interaction", guard, async (c) => {
    const user = c.get("user")!;
    const videoId = (c.req.param("videoId") ?? "").trim();
    if (!videoId) return fail(c, "対象が指定されていません。", 400);

    const input = await readAdminJsonBody(c.req.raw);
    if (input.kind === "too_large") return fail(c, BODY_TOO_LARGE_MESSAGE, 413);
    if (input.kind !== "ok") return fail(c, "不正な操作種別です。", 400);
    const parsed = VideoInteractionBodySchema.safeParse(input.value);
    if (!parsed.success) return fail(c, "不正な操作種別です。", 400);
    const kind = parsed.data.kind;

    const db = c.get("db");
    let snapshot: Snapshot | null;
    try {
      snapshot = await loadSnapshot(c.env.DB, videoId, user.id, kind);
    } catch {
      return fail(c, CONFLICT_MESSAGE, 503);
    }
    if (!snapshot) return fail(c, "対象作品が見つかりません。", 404);
    const { video, interaction: existing } = snapshot;
    if (video.visibility_status !== "public") {
      return fail(c, "公開中の作品だけ操作できます。", 403);
    }

    const active = !existing;
    const now = Math.floor(Date.now() / 1000);
    const interactionAfter = active
      ? { auth_user_id: user.id, video_id: videoId, interaction_type: kind, created_at: now }
      : null;
    // The public/updated_at snapshot is checked inside the atomic D1 batch.
    const publicSnapshotExists = sql`EXISTS (
      SELECT 1 FROM videos AS interaction_target
      WHERE interaction_target.id = ${videoId}
        AND interaction_target.visibility_status = 'public'
        AND interaction_target.updated_at = ${video.updated_at}
    )`;
    const interactionStatement = active
      ? db.run(sql`INSERT INTO video_interactions_auth
          (auth_user_id, video_id, interaction_type, created_at)
          SELECT ${user.id}, ${videoId}, ${kind}, ${now}
          WHERE ${publicSnapshotExists}`)
      : db.run(sql`DELETE FROM video_interactions_auth
          WHERE auth_user_id = ${user.id}
            AND video_id = ${videoId}
            AND interaction_type = ${kind}
            AND created_at = ${existing!.created_at}
            AND ${publicSnapshotExists}`);

    const mutationStatements: Array<Parameters<typeof mutateWithAudit>[1]["mutationStatements"][number]> = [interactionStatement];
    const expectedChanges = [1];
    const audits: WriteAuditLogInput[] = [{
      table_name: "video_interactions_auth",
      target_id: auditTargetId(user.id, videoId, kind),
      operation: active ? "CREATE" as const : "DELETE" as const,
      before: existing ? { ...existing } : null,
      after: interactionAfter ? { ...interactionAfter } : null,
      actor_user_id: user.id,
      reason: `${kind}:${active ? "activate" : "deactivate"}`,
      context: "video-interaction",
      retention_class: "normal" as const,
      strict: true,
    }];

    if (kind === "like") {
      const nextLikeCount = nextVideoAppLikeCount(video.app_like_count, active);
      mutationStatements.push(db.run(sql`UPDATE videos
        SET app_like_count = ${nextLikeCount}, updated_at = ${now}
        WHERE id = ${videoId} AND visibility_status = 'public'
          AND app_like_count = ${video.app_like_count}
          AND updated_at = ${video.updated_at}`));
      expectedChanges.push(1);
      audits.push({
        table_name: "videos",
        target_id: videoId,
        operation: "UPDATE",
        before: { ...video },
        after: { ...video, app_like_count: nextLikeCount, updated_at: now },
        actor_user_id: user.id,
        reason: `like:${active ? "increment" : "decrement"}`,
        context: "video-interaction",
        retention_class: "normal",
        strict: true,
      });
      const queue = await buildStaticRebuildQueueBatch(db, [
        { targetType: "video", targetId: videoId, reason: "video_like_count_change", priority: "normal", requestedByUserId: user.id },
        { targetType: "list_popular", targetId: "global", reason: "video_like_count_change", priority: "normal", requestedByUserId: user.id },
      ]);
      mutationStatements.push(...queue.statements);
      expectedChanges.push(...queue.expectedChanges);
    }

    try {
      await mutateWithAudit(db, {
        mutationStatements,
        expectedMutationChanges: expectedChanges,
        audits,
        preloaded: auditPreloaded(c),
        // D-0603-1: the queue rows stay atomic; no separate wake from Hono.
      });
    } catch (error) {
      if (active && isUniqueConflict(error)) {
        const result: VideoInteractionResult = { ok: true, active, videoId };
        return c.json(result);
      }
      return fail(c, CONFLICT_MESSAGE, 409);
    }
    const result: VideoInteractionResult = { ok: true, active, videoId };
    return c.json(result);
  });
  return routes;
}
