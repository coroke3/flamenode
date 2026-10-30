/**
 * MIG-0643 U02 (SA-070..073). NOT MOUNTED: PR #472 owns the parent admin router.
 * Parent guarantees origin, session, admin role and Drizzle instance. This
 * module adds the feature-specific CostGuard and a bounded D1 preflight read.
 *
 * D-0603-1: TARGET API has no Queue binding. Persist queue in atomic D1
 * batch; cron reclaims. The missing immediate wake is an explicit difference.
 */
import { Hono } from "hono";
import {
  AdminStaticRebuildBodySchema,
  type AdminStaticRebuildResult,
} from "@flamenode/contracts/admin/staticRebuildOps";
import { buildStaticRebuildQueueBatch } from "@flamenode/server-core/staticRebuild/enqueue";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import type { WriteAuditLogInput } from "@flamenode/server-core/audit/types";
import { sql } from "@flamenode/server-core/sql";
import type { AppEnv } from "../../env.ts";
import { MAX_SINGLE_ROW_LIMIT } from "../../lib/limits.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "./body.ts";

const FAILURE = "更新が競合したか監査記録に失敗しました。";
const BULK_RETRY_MAX = 8;
export const STATIC_REBUILD_COLUMNS = [
  "id", "target_type", "target_id", "reason", "priority", "status",
  "attempt_count", "requested_by_user_id", "created_at", "updated_at",
  "processing_started_at", "lease_token", "lease_expires_at", "processed_at",
  "next_retry_at", "error",
] as const;
type QueueRow = Record<(typeof STATIC_REBUILD_COLUMNS)[number], unknown> & {
  id: string;
  status: string;
  created_at: number;
  updated_at: number;
};
const columns = STATIC_REBUILD_COLUMNS.map((c) => `"${c}"`).join(", ");

const failure = (
  c: { json: (b: AdminStaticRebuildResult, status: 400 | 413 | 500) => Response },
  status: 400 | 413 | 500,
  message: string,
) => c.json({ ok: false, message }, status);

const result = (c: { json: (b: AdminStaticRebuildResult, status: 200) => Response }, values: Omit<AdminStaticRebuildResult, "ok"> = {}) =>
  c.json({ ok: true, ...values }, 200);

async function loadFailedRows(d1: D1Database, id?: string): Promise<QueueRow[]> {
  if (id) {
    const row = await d1.prepare(
      `SELECT ${columns} FROM static_rebuild_queue
       WHERE id = ? LIMIT ${MAX_SINGLE_ROW_LIMIT}`,
    ).bind(id).first<QueueRow>();
    return row && row.status === "failed" ? [row] : [];
  }
  const response = await d1.prepare(
    `SELECT ${columns} FROM static_rebuild_queue
     WHERE status = 'failed' ORDER BY created_at ASC LIMIT ${BULK_RETRY_MAX + 1}`,
  ).bind().all<QueueRow>();
  return response.results.slice(0, BULK_RETRY_MAX);
}

async function retryRows(c: import("hono").Context<AppEnv>, rows: QueueRow[]): Promise<Response> {
  if (!rows.length) return result(c, { retried: 0 });
  const db = c.get("db");
  const now = Math.floor(Date.now() / 1000);
  const statements = rows.map((before) => {
    const patch = {
      status: "pending", priority: "high", next_retry_at: null, error: null,
      lease_token: null, lease_expires_at: null, updated_at: now,
    };
    return db.run(sql`
      UPDATE static_rebuild_queue
      SET status = ${patch.status}, priority = ${patch.priority},
          next_retry_at = NULL, error = NULL, lease_token = NULL,
          lease_expires_at = NULL, updated_at = ${patch.updated_at}
      WHERE id = ${before.id}
        AND (${expectedRowCondition({ expectedCurrent: { ...before } })})
    `);
  });
  const audits: WriteAuditLogInput[] = rows.map((before) => ({
    table_name: "static_rebuild_queue",
    target_id: before.id,
    operation: "UPDATE",
    before: { ...before },
    after: {
      ...before, status: "pending", priority: "high", next_retry_at: null,
      error: null, lease_token: null, lease_expires_at: null, updated_at: now,
    },
    actor_user_id: c.get("user")!.id,
    context: "admin_static_rebuild_retry",
    reason: "失敗した静的再生成を手動リトライ",
    retention_class: "normal",
    strict: true,
  }));
  await mutateWithAudit(db, {
    mutationStatements: statements,
    expectedMutationChanges: rows.map(() => 1),
    audits,
    preloaded: auditPreloaded(c),
  });
  return result(c, { retried: rows.length });
}

export const staticRebuildAdminRoutes = new Hono<AppEnv>();
// The static backfill module is mounted as a sibling at /static-builds/backfill.
// A wildcard CostGuard here also matches that sibling, doubling preflight D1
// reads on backfill requests. Scope guard to the four owned SA-070..073 paths.
for (const path of [
  "/queue/:queueId/retry",
  "/retry-failed",
  "/rebuild",
  "/shared-inputs/rebuild",
]) {
  staticRebuildAdminRoutes.use(path, onlyMutating(costGuardMiddleware("admin_static_rebuild")));
}

// SA-070
staticRebuildAdminRoutes.post("/queue/:queueId/retry", async (c) => {
  const id = c.req.param("queueId").trim();
  if (!id || id.length > 128) return failure(c, 400, "対象キューIDが不正です。");
  try {
    return await retryRows(c, await loadFailedRows(c.env.DB, id));
  } catch {
    // D1/SQLite provider exceptions must never appear in application logs.
    console.error("[static-rebuild-admin] retry failed (D1/audit unavailable)");
    return failure(c, 500, FAILURE);
  }
});

// SA-073. CURRENT LIMIT 9 and updates up to 8 failed rows in one batch.
staticRebuildAdminRoutes.post("/retry-failed", async (c) => {
  try {
    return await retryRows(c, await loadFailedRows(c.env.DB));
  } catch {
    // D1/SQLite provider exceptions must never appear in application logs.
    console.error("[static-rebuild-admin] retry all failed (D1/audit unavailable)");
    return failure(c, 500, FAILURE);
  }
});

async function enqueue(
  c: import("hono").Context<AppEnv>,
  targets: Parameters<typeof buildStaticRebuildQueueBatch>[1],
  auditTarget: string,
  auditAfter: Record<string, unknown>,
  reason: string,
): Promise<Response> {
  try {
    const batch = await buildStaticRebuildQueueBatch(c.get("db"), targets);
    if (!batch.statements.length) return result(c, { queued: 0 });
    await mutateWithAudit(c.get("db"), {
      mutationStatements: batch.statements,
      expectedMutationChanges: batch.expectedChanges,
      preloaded: auditPreloaded(c),
      audits: [{
        table_name: "static_rebuild_queue",
        target_id: auditTarget,
        operation: "CREATE",
        after: auditAfter,
        actor_user_id: c.get("user")!.id,
        context: "admin_static_rebuild_enqueue",
        reason,
        retention_class: "normal",
        strict: true,
      }],
      // D-0603-1: no immediate Queue binding in target API.
    });
    return result(c, { queued: batch.acceptedTargetCount });
  } catch {
    // D1/SQLite provider exceptions must never appear in application logs.
    console.error("[static-rebuild-admin] enqueue failed (D1/audit unavailable)");
    return failure(c, 500, FAILURE);
  }
}

// SA-071: manual high-priority request.
staticRebuildAdminRoutes.post("/rebuild", async (c) => {
  const raw = await readAdminJsonBody(c.req.raw);
  if (raw.kind === "too_large") return failure(c, 413, BODY_TOO_LARGE_MESSAGE);
  const parsed = raw.kind === "ok" ? AdminStaticRebuildBodySchema.safeParse(raw.value) : null;
  if (!parsed?.success) return failure(c, 400, "入力内容を確認してください。");
  const { target_type, target_id, reason } = parsed.data;
  return enqueue(c, [{
    targetType: target_type, targetId: target_id, reason,
    priority: "high", requestedByUserId: c.get("user")!.id,
  }], `manual:${target_type}:${target_id}`, {
    target_type, target_id, reason, priority: "high",
    requested_by_user_id: c.get("user")!.id,
  }, "静的再生成を手動登録");
});

// SA-072: two shared R2-related *queue targets*. No direct R2 reads.
staticRebuildAdminRoutes.post("/shared-inputs/rebuild", async (c) => {
  const reason = "admin_shared_related_inputs_rebuild";
  const actor = c.get("user")!.id;
  return enqueue(c, [
    { targetType: "youtube_related_blocklist", targetId: "global", reason, priority: "high", requestedByUserId: actor },
    { targetType: "random_video_pool", targetId: "global", reason, priority: "high", requestedByUserId: actor },
  ], "manual:shared_related_inputs:global", {
    targets: ["youtube_related_blocklist", "random_video_pool"],
    reason, priority: "high", requested_by_user_id: actor,
  }, "関連動画共有JSONをまとめて再生成登録");
});
