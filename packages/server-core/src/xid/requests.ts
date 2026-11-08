/**
 * MIG-0659 U02/U03: X ID request / cancel / merge-revert request core (SA-099, SA-100, SA-101).
 *
 * Logic is a line-for-line port of CURRENT src/lib/actions/xid.ts requestXIdLink (:300),
 * cancelXIdLinkRequest (:558) and requestXIdMergeRevert (:740). The Hono route owns the write guard,
 * body parsing and HTTP status; this core returns the CURRENT result object plus a status class.
 * No Next revalidatePath: the SPA refetches. No Queue wake (D-0603-1): the outbox rows stay atomic in
 * the same D1 batch as the request row and the audit rows.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { users, xIdentityRequests, xUsers } from "@flamenode/db/schema";
import {
  X_ID_LINK_REQUEST_TYPES,
  buildXIdentityDecisionFields,
  isRetryableXIdMutationError,
  isRevertDeadlineOpen,
  isXIdLinkRequestType,
  normalizeXId,
  parseXIdentityInput,
  processedXIdRequestMessage,
  reconcilePendingXIdRequest,
  validateXIdentityRequestShape,
  type XIdentityRequestType,
} from "@flamenode/domain/xid";
import { mutateWithAudit } from "../audit/mutate.ts";
import type { PreloadedAuditContext } from "../audit/logger.ts";
import type { WriteAuditLogInput } from "../audit/types.ts";
import type { ServerCoreDb } from "../db.ts";
import { generateId } from "../id.ts";
import { resolveNotificationActor } from "../notifications/actor.ts";
import { buildOpsChannelWebhookStatement, type OpsChannelWebhookStatement } from "../notifications/opsOutbox.ts";
import {
  buildChannelXIdCancelledNotification,
  buildChannelXIdRequestNotification,
  buildXIdCancelThreadName,
  buildXIdRequestThreadName,
} from "../notifications/xidRequestChannel.ts";
import {
  buildPendingXIdMergeRevertInsert,
  buildPendingXIdRequestInsert,
} from "./pendingInsert.ts";
import { isAuthUserLinkedToXUser, resolveCanonicalXUserResolutions } from "./requestIdentity.ts";

/** CURRENT XIdActionResult plus the HTTP class the route answers with (D-16-1: 200 / 400 / 403 / 404 / 409, 503 for D1). */
export type XIdRequestOutcome = {
  status: 200 | 400 | 403 | 404 | 409 | 503;
  body: { ok: boolean; message?: string };
};

export type XIdRequestContext = {
  authUserId: string;
  /** normalizeXId(users.active_x_user_id) or null (CURRENT guard.activeXId). */
  actorXUserId: string | null;
  /** Configured public origin for notification links (CURRENT NEXT_PUBLIC_SITE_URL). */
  siteUrl: string | null | undefined;
  preloaded?: PreloadedAuditContext;
};

const done = (message: string, status: 200 = 200): XIdRequestOutcome => ({ status, body: { ok: true, message } });
const fail = (status: XIdRequestOutcome["status"], message: string): XIdRequestOutcome => ({
  status,
  body: { ok: false, message },
});

const nowUnix = () => Math.floor(Date.now() / 1000);

type NullableRequestIdColumn =
  | typeof xIdentityRequests.requested_x_id
  | typeof xIdentityRequests.source_x_user_id
  | typeof xIdentityRequests.target_x_user_id;

function nullableRequestColumnEquals(column: NullableRequestIdColumn, value: string | null): SQL {
  return value === null ? sql`${column} IS NULL` : sql`${column} = ${value}`;
}

type RequestIdentity = {
  authUserId: string;
  requestType: XIdentityRequestType;
  requestedXId: string | null;
  sourceXUserId: string | null;
  targetXUserId: string | null;
};

function equivalentPendingRequestCondition(input: RequestIdentity): SQL {
  const typeCondition = isXIdLinkRequestType(input.requestType)
    ? inArray(xIdentityRequests.request_type, X_ID_LINK_REQUEST_TYPES)
    : eq(xIdentityRequests.request_type, input.requestType);
  return and(
    eq(xIdentityRequests.requested_by_auth_user_id, input.authUserId),
    typeCondition,
    eq(xIdentityRequests.status, "pending"),
    nullableRequestColumnEquals(xIdentityRequests.requested_x_id, input.requestedXId),
    nullableRequestColumnEquals(xIdentityRequests.source_x_user_id, input.sourceXUserId),
    nullableRequestColumnEquals(xIdentityRequests.target_x_user_id, input.targetXUserId),
  )!;
}

async function findEquivalentPendingRequestId(db: ServerCoreDb, input: RequestIdentity): Promise<string | null> {
  const row = (
    await db
      .select({ id: xIdentityRequests.id })
      .from(xIdentityRequests)
      .where(equivalentPendingRequestCondition(input))
      .limit(1)
  )[0];
  return row?.id ?? null;
}

async function reconcileRequestPersistence(db: ServerCoreDb, input: RequestIdentity) {
  const matchingPendingRequestId = await findEquivalentPendingRequestId(db, input);
  if (matchingPendingRequestId) {
    return reconcilePendingXIdRequest({ matchingPendingRequestId, pendingCount: 0 });
  }
  const rows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(xIdentityRequests)
    .where(
      and(
        eq(xIdentityRequests.requested_by_auth_user_id, input.authUserId),
        eq(xIdentityRequests.status, "pending"),
      )!,
    );
  return reconcilePendingXIdRequest({
    matchingPendingRequestId: null,
    pendingCount: Number(rows[0]?.count ?? 0),
  });
}

/** CURRENT afterXIdLinkRequestAccepted minus revalidatePath: best-effort onboarding marker (conditional UPDATE). */
async function afterXIdLinkRequestAccepted(
  db: ServerCoreDb,
  authUserId: string,
  requestType: XIdentityRequestType,
): Promise<void> {
  if (!isXIdLinkRequestType(requestType)) return;
  try {
    await db
      .update(users)
      .set({ onboarding_completed_at: nowUnix() })
      .where(and(eq(users.id, authUserId), sql`${users.onboarding_completed_at} IS NULL`)!);
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "onboarding_marker",
        result: "failed",
        auth_user_id: authUserId,
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
}

export type RequestXIdLinkInput = {
  x_id: string;
  request_type?: string;
  link_type?: string;
  target_x_user_id: string;
};

/** SA-099 requestXIdLink. */
export async function requestXIdLinkCore(
  db: ServerCoreDb,
  ctx: XIdRequestContext,
  input: RequestXIdLinkInput,
): Promise<XIdRequestOutcome> {
  const { authUserId, actorXUserId } = ctx;
  const requestedXUserId = parseXIdentityInput(input.x_id);
  if (!requestedXUserId) {
    return fail(
      400,
      "X ID は @username、username、または x.com / twitter.com のプロフィール URL で入力してください（1〜20 文字）。",
    );
  }
  const kind = input.request_type ?? input.link_type ?? "link";
  if (kind !== "link" && kind !== "merge") return fail(400, "不正な申請種別です。");

  const targetXUserId = normalizeXId(input.target_x_user_id);

  let existingXUser: typeof xUsers.$inferSelect | undefined;
  let canonicalXUserId: string | null;
  let resolutionReason: string | undefined;
  try {
    existingXUser = (
      await db.select().from(xUsers).where(sql`lower(${xUsers.id}) = ${normalizeXId(requestedXUserId)}`).limit(1)
    )[0];
    const resolution = (await resolveCanonicalXUserResolutions(db, [requestedXUserId])).get(requestedXUserId);
    canonicalXUserId = resolution?.value ?? null;
    resolutionReason = resolution?.reason;
  } catch (error) {
    console.error("[requestXIdLink] identity lookup failed", error);
    return fail(503, "X ID情報を確認できませんでした。時間をおいて再試行してください。");
  }

  let requestType: XIdentityRequestType;
  let sourceXUserId: string | null = null;
  let requestedXId: string | null = requestedXUserId;

  if (
    resolutionReason === "invalid_alias_target" ||
    resolutionReason === "ambiguous_alias" ||
    resolutionReason === "canonical_alias_collision"
  ) {
    return fail(409, "この X ID のaliasまたは正本が不整合のため、申請を作成できません。");
  }

  if (kind === "merge") {
    requestType = "merge";
    sourceXUserId = requestedXUserId;
    requestedXId = null;
    if (!targetXUserId) return fail(400, "統合先 X ID が必要です。");
    if (!existingXUser) return fail(404, "統合元 X ID が見つかりません。");
    let ownsSource: boolean;
    let ownsTarget: boolean;
    try {
      [ownsSource, ownsTarget] = await Promise.all([
        isAuthUserLinkedToXUser(db, authUserId, sourceXUserId),
        isAuthUserLinkedToXUser(db, authUserId, targetXUserId),
      ]);
    } catch (error) {
      console.error("[requestXIdLink] merge ownership lookup failed", error);
      return fail(503, "連携状態を確認できませんでした。時間をおいて再試行してください。");
    }
    if (!ownsSource || !ownsTarget) {
      return fail(403, "自分に紐づく X ID 同士だけを統合申請できます。");
    }
  } else {
    requestType = canonicalXUserId || existingXUser ? "existing_link" : "new_link";
    try {
      if (await isAuthUserLinkedToXUser(db, authUserId, requestedXUserId)) {
        return fail(409, "この X ID はすでに現在のアカウントに紐づいています。");
      }
    } catch (error) {
      console.error("[requestXIdLink] account link lookup failed", error);
      return fail(503, "連携状態を確認できませんでした。時間をおいて再試行してください。");
    }
  }

  const shapeError = validateXIdentityRequestShape({
    requestType,
    requestedXId,
    sourceXUserId,
    targetXUserId: targetXUserId || null,
  });
  if (shapeError) return fail(400, shapeError);

  const requestIdentity: RequestIdentity = {
    authUserId,
    requestType,
    requestedXId,
    sourceXUserId,
    targetXUserId: targetXUserId || null,
  };
  try {
    if (await findEquivalentPendingRequestId(db, requestIdentity)) {
      return done("同じ内容の申請がすでに承認待ちです。");
    }
  } catch (error) {
    console.error("[requestXIdLink] pending lookup failed", error);
    return fail(503, "申請状況を確認できませんでした。時間をおいて再試行してください。");
  }

  const now = nowUnix();
  const id = generateId("xreq");
  const afterRequest = {
    id,
    request_type: requestType,
    requested_by_auth_user_id: authUserId,
    requested_x_id: requestedXId,
    source_x_user_id: sourceXUserId,
    target_x_user_id: targetXUserId || null,
    parent_request_id: null,
    restore_snapshot_json: null,
    revert_deadline_at: null,
    status: "pending" as const,
    requested_at: now,
    updated_at: now,
  };
  const mutationStatements: BatchItem<"sqlite">[] = [db.run(buildPendingXIdRequestInsert(afterRequest))];
  const expectedMutationChanges: Array<number | null> = [1];
  const audits: WriteAuditLogInput[] = [
    {
      table_name: "x_identity_requests",
      target_id: id,
      operation: "CREATE",
      before: null,
      after: { ...afterRequest },
      actor_user_id: authUserId,
      actor_x_user_id: actorXUserId,
      retention_class: "long_audit",
    },
  ];
  let webhookNotification: OpsChannelWebhookStatement | null = null;
  if (isXIdLinkRequestType(requestType)) {
    try {
      const requester = await resolveNotificationActor(db, authUserId);
      const xidForThread = requestedXId ?? sourceXUserId ?? targetXUserId ?? "不明";
      let requestedXName: string | null = null;
      if (requestedXId) {
        const xRow = (
          await db.select({ x_name: xUsers.x_name }).from(xUsers).where(eq(xUsers.id, requestedXId)).limit(1)
        )[0];
        requestedXName = xRow?.x_name?.trim() || null;
      }
      webhookNotification = await buildOpsChannelWebhookStatement(db, {
        target: "account",
        threadName: buildXIdRequestThreadName(xidForThread, requester),
        actorUserId: authUserId,
        payload: buildChannelXIdRequestNotification({
          requestId: id,
          requestType,
          requestedXId,
          sourceXUserId,
          targetXUserId: targetXUserId || null,
          requestedXName,
          requester,
          requestedAt: now,
          siteUrl: ctx.siteUrl,
        }),
        dedupeKey: `xid_request_webhook:${id}`,
      });
    } catch (error) {
      console.error("[requestXIdLink] ops notification preparation failed", error);
      return fail(503, "運営通知を準備できませんでした。時間をおいて再試行してください。");
    }
  }
  if (webhookNotification) {
    mutationStatements.push(webhookNotification.statement);
    expectedMutationChanges.push(null);
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mutateWithAudit(db, {
        mutationStatements,
        expectedMutationChanges,
        audits,
        preloaded: ctx.preloaded,
      });
      await afterXIdLinkRequestAccepted(db, authUserId, requestType);
      return done("X ID 申請を受け付けました。");
    } catch (error) {
      try {
        const reconciliation = await reconcileRequestPersistence(db, requestIdentity);
        if (reconciliation.outcome === "accepted") {
          await afterXIdLinkRequestAccepted(db, authUserId, requestType);
          return done("X ID 申請を受け付けました。");
        }
        if (reconciliation.outcome === "limit") {
          return fail(409, "未処理の X ID 申請が多すぎます。処理を待つか、不要な申請を取り下げてください。");
        }
      } catch (reconciliationError) {
        console.error("[requestXIdLink] reconciliation failed", reconciliationError);
      }
      if (attempt === 0 && isRetryableXIdMutationError(error)) continue;
      console.error("[requestXIdLink] mutation failed", error);
      return fail(503, "申請を保存できませんでした。申請履歴を確認してから再試行してください。");
    }
  }
  return fail(503, "申請を保存できませんでした。");
}

/** SA-100 cancelXIdLinkRequest (request id comes from the route path). */
export async function cancelXIdLinkRequestCore(
  db: ServerCoreDb,
  ctx: XIdRequestContext,
  requestId: string,
): Promise<XIdRequestOutcome> {
  const { authUserId, actorXUserId } = ctx;
  if (!requestId) return fail(400, "申請 ID がありません。");

  let request: typeof xIdentityRequests.$inferSelect | undefined;
  try {
    request = (await db.select().from(xIdentityRequests).where(eq(xIdentityRequests.id, requestId)).limit(1))[0];
  } catch (error) {
    console.error("[cancelXIdLinkRequest] lookup failed", error);
    return fail(503, "申請状況を確認できませんでした。時間をおいて再試行してください。");
  }
  if (!request || request.requested_by_auth_user_id !== authUserId) {
    return fail(404, "申請が見つかりません。");
  }
  if (request.status !== "pending") {
    const result = processedXIdRequestMessage(request.status, "cancel");
    return result.ok ? done(result.message ?? "") : fail(409, result.message ?? "");
  }
  if (
    request.request_type !== "new_link" &&
    request.request_type !== "existing_link" &&
    request.request_type !== "alias" &&
    request.request_type !== "merge" &&
    request.request_type !== "revert_merge"
  ) {
    return fail(409, "この申請は取り下げできません。");
  }

  const now = nowUnix();
  const decisionFields = buildXIdentityDecisionFields({
    decidedByAuthUserId: authUserId,
    decisionReason: "申請者による取り下げ",
    decidedAt: now,
  });
  const afterRequest = { ...request, status: "cancelled" as const, updated_at: now, ...decisionFields };
  const mutationStatements: BatchItem<"sqlite">[] = [
    db
      .update(xIdentityRequests)
      .set({ status: "cancelled" as const, updated_at: now, ...decisionFields })
      .where(
        and(
          eq(xIdentityRequests.id, request.id),
          eq(xIdentityRequests.status, "pending"),
          eq(xIdentityRequests.requested_by_auth_user_id, authUserId),
        )!,
      ),
  ];
  const expectedMutationChanges: Array<number | null> = [1];
  let cancelWebhookNotification: OpsChannelWebhookStatement | null = null;
  if (isXIdLinkRequestType(request.request_type) || request.request_type === "alias") {
    try {
      const requester = await resolveNotificationActor(db, authUserId);
      const xidForThread =
        request.requested_x_id ?? request.source_x_user_id ?? request.target_x_user_id ?? "不明";
      cancelWebhookNotification = await buildOpsChannelWebhookStatement(db, {
        target: "account",
        threadName: buildXIdCancelThreadName(xidForThread, requester),
        actorUserId: authUserId,
        payload: buildChannelXIdCancelledNotification({
          requestId: request.id,
          requestedXId: request.requested_x_id,
          sourceXUserId: request.source_x_user_id,
          targetXUserId: request.target_x_user_id,
          requester,
          cancelledAt: now,
          siteUrl: ctx.siteUrl,
        }),
        dedupeKey: `xid_cancel_webhook:${request.id}`,
      });
    } catch (error) {
      console.error("[cancelXIdLinkRequest] ops notification preparation failed", error);
      return fail(503, "取消通知を準備できませんでした。時間をおいて再試行してください。");
    }
  }
  if (cancelWebhookNotification) {
    mutationStatements.push(cancelWebhookNotification.statement);
    expectedMutationChanges.push(null);
  }
  const mutationInput = {
    mutationStatements,
    expectedMutationChanges,
    audits: [
      {
        table_name: "x_identity_requests",
        target_id: request.id,
        operation: "UPDATE" as const,
        before: { ...request },
        after: afterRequest,
        actor_user_id: authUserId,
        actor_x_user_id: actorXUserId,
        reason: "申請者本人がX ID申請を取り下げ",
        context: "x-identity-request",
        retention_class: "long_audit" as const,
      },
    ],
    preloaded: ctx.preloaded,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mutateWithAudit(db, mutationInput);
      return done("申請を取り下げました。");
    } catch (error) {
      try {
        const current = (
          await db
            .select({
              status: xIdentityRequests.status,
              requested_by_auth_user_id: xIdentityRequests.requested_by_auth_user_id,
            })
            .from(xIdentityRequests)
            .where(eq(xIdentityRequests.id, request.id))
            .limit(1)
        )[0];
        if (!current || current.requested_by_auth_user_id !== authUserId) {
          return fail(404, "申請が見つかりません。");
        }
        if (current.status !== "pending") {
          const result = processedXIdRequestMessage(current.status, "cancel");
          return result.ok ? done(result.message ?? "") : fail(409, result.message ?? "");
        }
      } catch (reconciliationError) {
        console.error("[cancelXIdLinkRequest] reconciliation failed", reconciliationError);
      }
      if (attempt === 0 && isRetryableXIdMutationError(error)) continue;
      console.error("[cancelXIdLinkRequest] mutation failed", error);
      return fail(503, "申請の取り下げに失敗しました。申請履歴を更新してから再試行してください。");
    }
  }
  return fail(503, "申請の取り下げに失敗しました。");
}

/** SA-101 requestXIdMergeRevert. Reads are not caught (CURRENT lets them propagate): the route maps a throw to 503. */
export async function requestXIdMergeRevertCore(
  db: ServerCoreDb,
  ctx: XIdRequestContext,
  parentRequestId: string,
): Promise<XIdRequestOutcome> {
  const { authUserId, actorXUserId } = ctx;
  if (!parentRequestId) return fail(400, "統合申請 ID が必要です。");

  const parent = (
    await db.select().from(xIdentityRequests).where(eq(xIdentityRequests.id, parentRequestId)).limit(1)
  )[0];
  if (!parent || parent.request_type !== "merge" || parent.status !== "done") {
    return fail(404, "差し戻し可能な統合申請が見つかりません。");
  }
  const now = nowUnix();
  const revertDeadlineAt = parent.revert_deadline_at;
  if (
    !parent.restore_snapshot_json ||
    revertDeadlineAt === null ||
    !isRevertDeadlineOpen(revertDeadlineAt, now)
  ) {
    return fail(409, "統合の差し戻し期限を過ぎています。");
  }
  if (!parent.target_x_user_id || !(await isAuthUserLinkedToXUser(db, authUserId, parent.target_x_user_id))) {
    return fail(403, "この統合を差し戻す権限がありません。");
  }
  const existing = (
    await db
      .select({ id: xIdentityRequests.id, status: xIdentityRequests.status })
      .from(xIdentityRequests)
      .where(
        and(
          eq(xIdentityRequests.request_type, "revert_merge"),
          eq(xIdentityRequests.parent_request_id, parentRequestId),
          inArray(xIdentityRequests.status, ["pending", "approved", "done"]),
        )!,
      )
      .limit(1)
  )[0];
  if (existing?.status === "done") return fail(409, "この統合はすでに差し戻されています。");
  if (existing?.status === "pending") return done("差し戻し申請はすでに承認待ちです。");
  if (existing?.status === "approved") return done("差し戻し申請は処理中です。");

  const id = generateId("xrevert");
  const afterRequest = {
    id,
    request_type: "revert_merge" as const,
    requested_by_auth_user_id: authUserId,
    requested_x_id: null,
    source_x_user_id: parent.source_x_user_id,
    target_x_user_id: parent.target_x_user_id,
    parent_request_id: parent.id,
    // Parent merge request is the one immutable snapshot source. Do not
    // duplicate up to 1MB of JSON into each pending revert child or audit row.
    restore_snapshot_json: null,
    revert_deadline_at: revertDeadlineAt,
    status: "pending" as const,
    requested_at: now,
    updated_at: now,
  };
  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(buildPendingXIdMergeRevertInsert({ row: afterRequest, parentUpdatedAt: parent.updated_at })),
      ],
      expectedMutationChanges: [1],
      audits: [
        {
          table_name: "x_identity_requests",
          target_id: id,
          operation: "CREATE",
          before: null,
          after: { ...afterRequest },
          actor_user_id: authUserId,
          actor_x_user_id: actorXUserId,
          retention_class: "long_audit",
        },
      ],
      preloaded: ctx.preloaded,
    });
  } catch (error) {
    console.error("[requestXIdMergeRevert] mutation failed", error);
    return fail(503, "差し戻し申請を保存できませんでした。時間をおいて再試行してください。");
  }
  return done("統合の差し戻し申請を受け付けました。");
}
