/**
 * MIG-0644 U02: admin X ID merge & revert Hono routes (SA-092..097, D-17-4).
 *
 * Mounted under createAdminRoutes at /api/admin/x-id-merges:
 *   POST /api/admin/x-id-merges                       SA-092 createXIdMergeRequest
 *   POST /api/admin/x-id-merges/:id/approve           SA-093 approveXIdMergeRequest
 *   POST /api/admin/x-id-merges/:id/reject            SA-094 rejectXIdMergeRequest
 *   POST /api/admin/x-id-merges/:id/execute           SA-096 executeXIdMergeRequest
 *   POST /api/admin/x-id-merges/reverts/:id/approve   SA-097 approveXIdMergeRevert
 *   POST /api/admin/x-id-merges/reverts/:id/reject    SA-095 rejectXIdMergeRevert
 *
 * Parent admin router enforces originGuardMiddleware -> sessionMiddleware ->
 * writeGuardMiddleware -> dbMiddleware. This router adds CostGuard("xid_links"),
 * enforces `Cache-Control: private, no-store`, delegates merge/revert to
 * `@flamenode/server-core/xid/merge` with wake=0 (`D-0603-1`), and never returns
 * raw SQL or provider exceptions.
 */
import { Hono, type Context } from "hono";
import { eq, inArray } from "drizzle-orm";
import { xIdentityRequests, xUsers } from "@flamenode/db/schema";
import {
  AdminXIdMergeConfirmBodySchema,
  AdminXIdMergeCreateBodySchema,
  AdminXIdMergeDecisionBodySchema,
  type AdminXIdMergeResult,
} from "@flamenode/contracts";
import {
  buildXIdentityDecisionFields,
  isRevertDeadlineOpen,
  normalizeXId,
  validateXIdentityRequestShape,
} from "@flamenode/domain/xid";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { generateId } from "@flamenode/server-core/id";
import type { QueueWakeHostLoader } from "@flamenode/server-core/ports";
import { PUBLIC_LISTABLE_X_APPROVAL_STATUSES } from "@flamenode/server-core/publicData/publicXUser";
import {
  putVisibilityManifestWithCas,
  readVisibilityManifestObject,
  type VisibilityManifestBucket,
} from "@flamenode/server-core/visibility/manifestR2";
import {
  executeApprovedXIdMergeRequest,
  restoreApprovedXIdMergeRevertRequest,
  type XIdMergeHost,
} from "@flamenode/server-core/xid/merge";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "./body.ts";

const ATOMIC_FAILURE =
  "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。";
const EXECUTE_FAILURE = "X ID統合を安全に確定できませんでした。";
const REVERT_FAILURE = "X ID統合を安全に差し戻せませんでした。";
const VISIBILITY_BUCKET_UNAVAILABLE = "X ID統合の公開境界を更新できませんでした。";
const PREFLIGHT_FAILED = "管理操作を処理できませんでした。再度お試しください。";

const KNOWN_MERGE_DOMAIN_ERRORS = new Set([
  "承認済みの統合申請だけを実行できます。",
  "統合元または統合先のX名義がありません。",
  "統合元または統合先のX名義を正規化できません。",
  "統合元と統合先が同一です。",
  "統合元または統合先のX名義が見つかりません。",
  "無効化済みのX名義は統合できません。",
  "統合元と統合先は承認済みのX名義である必要があります。",
  "差し戻し申請ではありません。",
  "この差し戻し申請は処理できません。",
  "親統合申請が完了状態ではありません。",
  "親統合申請が一致しません。",
  "差し戻しに必要な期限情報がありません。",
  "親統合申請に差し戻し用snapshotがありません。",
  "統合の差し戻し期限を過ぎています。",
  "親統合申請と復元snapshotのX名義が一致しません。",
  "restore_snapshot_json をJSONとして解析できません。",
  "restore_snapshot_json の形式またはversionが不正です。",
]);

class VisibilityBucketUnavailableError extends Error {
  constructor() {
    super(VISIBILITY_BUCKET_UNAVAILABLE);
    this.name = "VisibilityBucketUnavailableError";
  }
}

/** D-0603-1: Hono admin routes persist static_rebuild_queue without sending a Queue wake. */
const NOOP_WAKE_HOST: QueueWakeHostLoader = async () => ({
  readEnv: () => null,
  readWaitUntil: () => null,
  readKv: () => null,
});

type JsonStatus = 200 | 400 | 404 | 409 | 413 | 503;

function respond(c: Context<AppEnv>, status: JsonStatus, body: AdminXIdMergeResult) {
  c.header("Cache-Control", "private, no-store");
  return c.json<AdminXIdMergeResult>(body, status);
}

function fail(
  c: Context<AppEnv>,
  status: Exclude<JsonStatus, 200>,
  message: string,
  id?: string,
) {
  return respond(c, status, id ? { ok: false, id, message } : { ok: false, message });
}

function actorContext(c: Context<AppEnv>): { authUserId: string; actorXUserId: string | null } {
  const user = c.get("user")!;
  return {
    authUserId: user.id,
    actorXUserId: normalizeXId(user.active_x_user_id ?? "") || null,
  };
}

function requireVisibilityBucket(c: Context<AppEnv>): VisibilityManifestBucket {
  let bucket: VisibilityManifestBucket | undefined;
  try {
    bucket = c.env.BUCKET as unknown as VisibilityManifestBucket | undefined;
  } catch {
    throw new VisibilityBucketUnavailableError();
  }
  if (!bucket) {
    throw new VisibilityBucketUnavailableError();
  }
  return bucket;
}

function xIdMergeHostFor(c: Context<AppEnv>): XIdMergeHost {
  return {
    visibility: {
      listableApprovalStatuses: PUBLIC_LISTABLE_X_APPROVAL_STATUSES,
      manifest: {
        read: () => readVisibilityManifestObject(requireVisibilityBucket(c)),
        write: (manifest, options) =>
          putVisibilityManifestWithCas(
            requireVisibilityBucket(c),
            manifest,
            options?.ifMatchEtag,
            options?.mutateOnConflict,
          ),
      },
    },
    loadQueueWakeHost: NOOP_WAKE_HOST,
  };
}

async function parseJsonBody<T>(
  c: Context<AppEnv>,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  options: { optional?: boolean } = {},
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const hasEmptyBody =
    c.req.raw.body === null || c.req.header("content-length") === "0";
  if (options.optional && hasEmptyBody) {
    const emptyParsed = schema.safeParse({});
    if (emptyParsed.success) {
      return { ok: true, data: emptyParsed.data };
    }
    return { ok: false, response: fail(c, 400, "入力エラー") };
  }
  const read = await readAdminJsonBody(c.req.raw);
  if (read.kind === "too_large") {
    return { ok: false, response: fail(c, 413, BODY_TOO_LARGE_MESSAGE) };
  }
  if (read.kind !== "ok") {
    return { ok: false, response: fail(c, 400, "入力エラー") };
  }
  const parsed = schema.safeParse(read.value);
  if (!parsed.success) {
    return { ok: false, response: fail(c, 400, "入力エラー") };
  }
  return { ok: true, data: parsed.data };
}

async function handleRequestDecision(
  c: Context<AppEnv>,
  requestType: "merge" | "revert_merge",
  status: "approved" | "rejected",
): Promise<Response> {
  const body = await parseJsonBody(c, AdminXIdMergeDecisionBodySchema, { optional: true });
  if (!body.ok) return body.response;

  const id = (c.req.param("id") ?? "").trim();
  if (!id) return fail(c, 400, "申請 ID が必要です。");

  const db = c.get("db");
  const current = (
    await db
      .select()
      .from(xIdentityRequests)
      .where(eq(xIdentityRequests.id, id))
      .limit(1)
  )[0];
  if (!current || current.request_type !== requestType) {
    return fail(c, 404, "対象の申請が見つかりません。");
  }
  if (current.status !== "pending") {
    return fail(c, 409, `status=${current.status} は変更できません。`);
  }

  const { authUserId, actorXUserId } = actorContext(c);
  const now = Math.floor(Date.now() / 1000);
  const decisionFields = buildXIdentityDecisionFields({
    decidedByAuthUserId: authUserId,
    decisionReason: status === "approved" ? "X ID統合申請を承認" : "X ID統合申請を却下",
    decidedAt: now,
  });
  const after = { ...current, status, updated_at: now, ...decisionFields };

  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db
          .update(xIdentityRequests)
          .set({
            status,
            updated_at: now,
            ...decisionFields,
          })
          .where(expectedRowCondition({ expectedCurrent: current })),
      ],
      expectedMutationChanges: [1],
      preloaded: auditPreloaded(c),
      callerQueryCount: 4,
      audits: [
        {
          table_name: "x_identity_requests",
          target_id: id,
          operation: "UPDATE",
          before: current,
          after,
          actor_user_id: authUserId,
          actor_x_user_id: actorXUserId,
          reason: status === "approved" ? "X ID申請を承認" : "X ID申請を却下",
          context: "x-id-merge:request",
          retention_class: "long_audit",
        },
      ],
    });
  } catch {
    console.error("[MIG-0644] setRequestStatus atomic mutation failed");
    return fail(c, 409, ATOMIC_FAILURE);
  }

  return respond(c, 200, {
    ok: true,
    id,
    message: status === "approved" ? "承認しました。" : "却下しました。",
  });
}

function mapMergeExecutionFailure(
  c: Context<AppEnv>,
  id: string,
  cause: unknown,
  fallbackMessage: string,
): Response {
  if (cause instanceof VisibilityBucketUnavailableError) {
    return fail(c, 503, VISIBILITY_BUCKET_UNAVAILABLE, id);
  }
  if (cause instanceof Error && KNOWN_MERGE_DOMAIN_ERRORS.has(cause.message)) {
    return fail(c, 409, cause.message, id);
  }
  console.error("[MIG-0644] xid merge operation failed");
  return fail(c, 409, fallbackMessage, id);
}

export const adminXIdMergeRoutes = new Hono<AppEnv>();

// Keep D1 / provider exception details out of responses and operational logs.
adminXIdMergeRoutes.onError((_error, c) => fail(c, 503, PREFLIGHT_FAILED));
adminXIdMergeRoutes.use("*", onlyMutating(costGuardMiddleware("xid_links")));

// SA-092 createXIdMergeRequest (4 pre-reads: session + writeGuard + costGuard + 1 IN lookup)
adminXIdMergeRoutes.post("/", async (c) => {
  const body = await parseJsonBody(c, AdminXIdMergeCreateBodySchema);
  if (!body.ok) return body.response;

  const sourceXUserId = normalizeXId(String(body.data.from_x_user_id ?? ""));
  const targetXUserId = normalizeXId(String(body.data.to_x_user_id ?? ""));
  const shapeError = validateXIdentityRequestShape({
    requestType: "merge",
    sourceXUserId,
    targetXUserId,
  });
  if (shapeError) return fail(c, 400, shapeError);

  const db = c.get("db");
  const existingRows = await db
    .select({ id: xUsers.id })
    .from(xUsers)
    .where(inArray(xUsers.id, [sourceXUserId, targetXUserId]))
    .limit(2);
  const existingIds = new Set(existingRows.map((row) => row.id));
  if (!existingIds.has(sourceXUserId)) {
    return fail(c, 404, `統合元 @${sourceXUserId} が見つかりません。`);
  }
  if (!existingIds.has(targetXUserId)) {
    return fail(c, 404, `統合先 @${targetXUserId} が見つかりません。`);
  }

  const { authUserId, actorXUserId } = actorContext(c);
  const now = Math.floor(Date.now() / 1000);
  const id = generateId("xmerge");
  const row = {
    id,
    request_type: "merge" as const,
    requested_by_auth_user_id: authUserId,
    requested_x_id: null,
    source_x_user_id: sourceXUserId,
    target_x_user_id: targetXUserId,
    parent_request_id: null,
    restore_snapshot_json: null,
    revert_deadline_at: null,
    status: "pending" as const,
    requested_at: now,
    updated_at: now,
  };

  try {
    await mutateWithAudit(db, {
      mutationStatements: [db.insert(xIdentityRequests).values(row)],
      expectedMutationChanges: [1],
      preloaded: auditPreloaded(c),
      callerQueryCount: 4,
      audits: [
        {
          table_name: "x_identity_requests",
          target_id: id,
          operation: "CREATE",
          before: null,
          after: row,
          actor_user_id: authUserId,
          actor_x_user_id: actorXUserId,
          reason: "管理者がX ID統合申請を作成",
          context: "x-id-merge:request",
          retention_class: "long_audit",
        },
      ],
    });
  } catch {
    console.error("[MIG-0644] createXIdMergeRequest atomic mutation failed");
    return fail(c, 409, ATOMIC_FAILURE);
  }

  return respond(c, 200, { ok: true, id, message: "X ID 統合申請を作成しました。" });
});

// SA-097 approveXIdMergeRevert
adminXIdMergeRoutes.post("/reverts/:id/approve", async (c) => {
  const body = await parseJsonBody(c, AdminXIdMergeConfirmBodySchema, { optional: true });
  if (!body.ok) return body.response;

  const id = (c.req.param("id") ?? "").trim();
  const confirm = String(body.data.confirm ?? "").trim();
  if (!id) return fail(c, 400, "申請 ID が必要です。");
  if (confirm !== "REVERT") return fail(c, 400, "確認文字列 REVERT が必要です。");

  const db = c.get("db");
  const request = (
    await db
      .select()
      .from(xIdentityRequests)
      .where(eq(xIdentityRequests.id, id))
      .limit(1)
  )[0];
  if (!request || request.request_type !== "revert_merge") {
    return fail(c, 404, "差し戻し申請が見つかりません。");
  }

  const now = Math.floor(Date.now() / 1000);
  const shapeError = validateXIdentityRequestShape({
    requestType: "revert_merge",
    parentRequestId: request.parent_request_id,
    restoreSnapshotJson: request.restore_snapshot_json,
    revertDeadlineAt: request.revert_deadline_at,
  });
  if (shapeError) return fail(c, 400, shapeError);
  if (!isRevertDeadlineOpen(request.revert_deadline_at, now)) {
    return fail(c, 400, "統合の差し戻し期限を過ぎています。");
  }

  const parentRequest = (
    await db
      .select()
      .from(xIdentityRequests)
      .where(eq(xIdentityRequests.id, request.parent_request_id!))
      .limit(1)
  )[0];
  if (!parentRequest) return fail(c, 404, "親統合申請が見つかりません。");
  if (!parentRequest.restore_snapshot_json) {
    return fail(c, 400, "親統合申請に差し戻し用snapshotがありません。");
  }

  const { authUserId } = actorContext(c);
  try {
    const counts = await restoreApprovedXIdMergeRevertRequest(
      db,
      {
        request,
        parentRequest,
        actorAuthUserId: authUserId,
      },
      xIdMergeHostFor(c),
    );
    const totalRestored = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return respond(c, 200, {
      ok: true,
      id,
      message: `X ID統合を差し戻しました（${totalRestored}件復元）。`,
    });
  } catch (cause) {
    return mapMergeExecutionFailure(c, id, cause, REVERT_FAILURE);
  }
});

// SA-095 rejectXIdMergeRevert
adminXIdMergeRoutes.post("/reverts/:id/reject", (c) =>
  handleRequestDecision(c, "revert_merge", "rejected"),
);

// SA-093 approveXIdMergeRequest
adminXIdMergeRoutes.post("/:id/approve", (c) =>
  handleRequestDecision(c, "merge", "approved"),
);

// SA-094 rejectXIdMergeRequest
adminXIdMergeRoutes.post("/:id/reject", (c) =>
  handleRequestDecision(c, "merge", "rejected"),
);

// SA-096 executeXIdMergeRequest
adminXIdMergeRoutes.post("/:id/execute", async (c) => {
  const body = await parseJsonBody(c, AdminXIdMergeConfirmBodySchema, { optional: true });
  if (!body.ok) return body.response;

  const id = (c.req.param("id") ?? "").trim();
  const confirm = String(body.data.confirm ?? "").trim();
  if (!id) return fail(c, 400, "申請 ID が必要です。");
  if (confirm !== "MERGE") return fail(c, 400, "確認文字列 MERGE が必要です。");

  const db = c.get("db");
  const request = (
    await db
      .select()
      .from(xIdentityRequests)
      .where(eq(xIdentityRequests.id, id))
      .limit(1)
  )[0];
  if (!request || request.request_type !== "merge") {
    return fail(c, 404, "統合申請が見つかりません。");
  }

  const shapeError = validateXIdentityRequestShape({
    requestType: "merge",
    sourceXUserId: request.source_x_user_id,
    targetXUserId: request.target_x_user_id,
  });
  if (shapeError) return fail(c, 400, shapeError);

  const { authUserId } = actorContext(c);
  try {
    const result = await executeApprovedXIdMergeRequest(
      db,
      {
        request,
        actorAuthUserId: authUserId,
      },
      xIdMergeHostFor(c),
    );
    const totalUpdated = Object.values(result.counts).reduce((sum, value) => sum + value, 0);
    return respond(c, 200, {
      ok: true,
      id,
      message: `@${request.source_x_user_id} → @${request.target_x_user_id} に統合しました（${totalUpdated}件更新）。`,
    });
  } catch (cause) {
    return mapMergeExecutionFailure(c, id, cause, EXECUTE_FAILURE);
  }
});
