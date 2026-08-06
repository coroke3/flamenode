"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { writeGuard } from "@/lib/auth/writeGuard";
import { getEnv } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import {
  users,
  xIdentityRequests,
  xUserAccountLinks,
  xUsers,
} from "@/lib/db/schema";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { validateIconImageUpload } from "@/lib/utils/imageUpload";
import { tryDeleteUnreferencedIcon } from "@/lib/media/iconOrphanCleanup";
import { generateId } from "@/lib/utils/id";
import { normalizeHttpUrl } from "@/lib/utils/url";
import { normalizePortfolioContact } from "@/lib/profileContact";
import { normalizeXId, parseXIdentityInput } from "@/lib/utils/xid";
import { validateSocialLinksJson } from "@/lib/socialLinks";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import type { BatchItem } from "drizzle-orm/batch";
import type { NotificationOutboxStatement } from "@/lib/notifications/enqueue";
import {
  getLinkedXUserForAuthUser,
  isAuthUserLinkedToXUser,
  resolveCanonicalXUserId,
} from "@/lib/auth/xIdentity";
import {
  validateXIdentityRequestShape,
  type XIdentityRequestType,
} from "@/lib/auth/xIdentityRequestCore";
import { getXIconCandidates } from "@/lib/db/xIconResolution";
import { buildPendingXIdRequestInsert } from "@/lib/actions/xidPendingInsert";
import {
  X_ID_LINK_REQUEST_TYPES,
  isRetryableXIdMutationError,
  isXIdLinkRequestType,
  processedXIdRequestMessage,
  reconcilePendingXIdRequest,
} from "@/lib/actions/xidRequestReliabilityCore";
import { enqueueAfterXUserPublicUpdate } from "@/lib/staticRebuild/hooks";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import { maybeMarkOnboardingComplete } from "@/lib/auth/onboarding";
import { buildXIdentityDecisionFields } from "@/lib/auth/xIdentityRequestCore";
import {
  assessXLinkDeletion,
  xLinkDeletionAllowedSql,
} from "@/lib/auth/xLinkDependencies";

export interface XIdActionResult {
  ok: boolean;
  message?: string;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function xUserIdMatches(xUserId: string) {
  return sql`lower(${xUsers.id}) = ${normalizeXId(xUserId)}`;
}

type NullableRequestIdColumn =
  | typeof xIdentityRequests.requested_x_id
  | typeof xIdentityRequests.source_x_user_id
  | typeof xIdentityRequests.target_x_user_id;

function nullableRequestColumnEquals(
  column: NullableRequestIdColumn,
  value: string | null,
): SQL {
  return value === null ? sql`${column} IS NULL` : sql`${column} = ${value}`;
}

function equivalentPendingRequestCondition(input: {
  authUserId: string;
  requestType: XIdentityRequestType;
  requestedXId: string | null;
  sourceXUserId: string | null;
  targetXUserId: string | null;
}): SQL {
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

async function findEquivalentPendingRequestId(
  db: DB,
  input: Parameters<typeof equivalentPendingRequestCondition>[0],
): Promise<string | null> {
  const row = (
    await db
      .select({ id: xIdentityRequests.id })
      .from(xIdentityRequests)
      .where(equivalentPendingRequestCondition(input))
      .limit(1)
  )[0];
  return row?.id ?? null;
}

async function reconcileRequestPersistence(
  db: DB,
  input: Parameters<typeof equivalentPendingRequestCondition>[0],
) {
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

async function getXIdWriteContext(): Promise<
  | { ok: true; authUserId: string; db: DB; actorXUserId: string | null }
  | { ok: false; result: XIdActionResult }
> {
  try {
    const guard = await writeGuard({ feature: "xid_links" });
    if (!guard.ok) {
      return { ok: false, result: { ok: false, message: guard.message } };
    }
    return {
      ok: true,
      authUserId: guard.user.id,
      db: guard.db,
      actorXUserId: normalizeXId(guard.activeXId ?? "") || null,
    };
  } catch (error) {
    // redirect/notFound 等のNext.js制御例外はAction結果へ変換しない。
    unstable_rethrow(error);
    console.error("[xid] write context unavailable", error);
    return {
      ok: false,
      result: {
        ok: false,
        message: "認証またはDBに接続できません。時間をおいて再試行してください。",
      },
    };
  }
}

async function getLinkedXUser(db: DB, xUserId: string, authUserId: string) {
  return getLinkedXUserForAuthUser(db, authUserId, xUserId);
}

function requireApprovedForEdit(row: {
  approval_status: string | null;
}): XIdActionResult | null {
  if (row.approval_status !== "approved") {
    return { ok: false, message: "承認済みの X ID だけを編集できます。" };
  }
  return null;
}

function buildXUserProfileUpdate(values: {
  displayName: string;
  profileText: string | null;
  portfolioContact: string | null;
  youtubeChannelUrl: string | null;
  otherSocialLinks: string | null;
}): Pick<
  typeof xUsers.$inferInsert,
  "x_name" | "profile_text" | "portfolio_contact" | "youtube_channel_url" | "other_social_links"
> {
  return {
    x_name: values.displayName,
    profile_text: values.profileText,
    portfolio_contact: values.portfolioContact,
    youtube_channel_url: values.youtubeChannelUrl,
    other_social_links: values.otherSocialLinks,
  };
}

function revalidateXIdentityPaths(xUserId?: string): void {
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  revalidatePath("/onboarding");
  revalidatePath("/admin/x-link-requests");
  revalidatePath("/manage/x-link-requests");
  if (xUserId) revalidatePath(`/user/${xUserId}`);
}

function revalidateXIdRequestPaths(): void {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  revalidatePath("/onboarding");
}

async function runXIdPostCommit(
  flow: string,
  taskName: string,
  run: () => void | Promise<void>,
): Promise<void> {
  await runPostCommitBestEffort(
    { flow, traceId: createTraceId() },
    [{ name: taskName, run: async () => { await run(); } }],
  );
}

async function afterXIdLinkRequestAccepted(
  db: DB,
  authUserId: string,
  requestType: XIdentityRequestType,
): Promise<void> {
  await runXIdPostCommit("xid.requestXIdLink", "revalidate", () => {
    revalidateXIdRequestPaths();
  });
  if (isXIdLinkRequestType(requestType)) {
    await maybeMarkOnboardingComplete(db, authUserId, { xIdentityStatus: "pending" });
  }
}

export async function setActiveXId(formData: FormData): Promise<XIdActionResult> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId } = context;

  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  if (!xUserId) return { ok: false, message: "X ID が指定されていません。" };

  const db = context.db;

  const xRow = await getLinkedXUser(db, xUserId, authUserId);
  if (!xRow) {
    return { ok: false, message: "この X ID は現在のアカウントに紐づいていません。" };
  }
  if (xRow.approval_status !== "approved") {
    return { ok: false, message: "承認済みの X ID だけをアクティブにできます。" };
  }

  const beforeUser = (
    await db.select().from(users).where(eq(users.id, authUserId)).limit(1)
  )[0];
  if (!beforeUser) return { ok: false, message: "ユーザーが見つかりません。" };
  if (normalizeXId(beforeUser.active_x_user_id) === xUserId) {
    return { ok: true, message: "すでにこの X ID がアクティブです。" };
  }

  const afterUser = { ...beforeUser, active_x_user_id: xUserId };
  await mutateWithAudit(db, {
    mutationStatements: [
      db
        .update(users)
        .set({ active_x_user_id: xUserId })
        .where(expectedRowCondition({ expectedCurrent: beforeUser })),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "user",
        target_id: authUserId,
        operation: "UPDATE",
        before: { ...beforeUser },
        after: { ...afterUser },
        actor_user_id: authUserId,
        actor_x_user_id: xUserId,
        retention_class: "normal",
      },
    ],
  });

  await runXIdPostCommit("xid.setActiveXId", "revalidate", () => {
    revalidateXIdentityPaths(xUserId);
  });
  return { ok: true, message: "アクティブ X ID を切り替えました。" };
}

const requestKindSchema = z.enum(["link", "merge"]);

export async function requestXIdLink(formData: FormData): Promise<XIdActionResult> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId, actorXUserId } = context;

  const requestedXUserId = parseXIdentityInput(String(formData.get("x_id") ?? ""));
  if (!requestedXUserId) {
    return {
      ok: false,
      message:
        "X ID は @username、username、または x.com / twitter.com のプロフィール URL で入力してください（1〜20 文字）。",
    };
  }

  const parsedKind = requestKindSchema.safeParse(
    String(formData.get("request_type") ?? formData.get("link_type") ?? "link"),
  );
  if (!parsedKind.success) return { ok: false, message: "不正な申請種別です。" };

  const targetXUserId = normalizeXId(String(formData.get("target_x_user_id") ?? ""));
  const db = context.db;

  let existingXUser: typeof xUsers.$inferSelect | undefined;
  let canonicalXUserId: string | null;
  try {
    existingXUser = (
      await db.select().from(xUsers).where(xUserIdMatches(requestedXUserId)).limit(1)
    )[0];
    canonicalXUserId = await resolveCanonicalXUserId(db, requestedXUserId);
  } catch (error) {
    console.error("[requestXIdLink] identity lookup failed", error);
    return {
      ok: false,
      message: "X ID情報を確認できませんでした。時間をおいて再試行してください。",
    };
  }

  let requestType: XIdentityRequestType;
  let sourceXUserId: string | null = null;
  let requestedXId: string | null = requestedXUserId;

  if (parsedKind.data === "merge") {
    requestType = "merge";
    sourceXUserId = requestedXUserId;
    requestedXId = null;
    if (!targetXUserId) return { ok: false, message: "統合先 X ID が必要です。" };
    if (!existingXUser) return { ok: false, message: "統合元 X ID が見つかりません。" };
    let ownsSource: boolean;
    let ownsTarget: boolean;
    try {
      [ownsSource, ownsTarget] = await Promise.all([
        isAuthUserLinkedToXUser(db, authUserId, sourceXUserId),
        isAuthUserLinkedToXUser(db, authUserId, targetXUserId),
      ]);
    } catch (error) {
      console.error("[requestXIdLink] merge ownership lookup failed", error);
      return {
        ok: false,
        message: "連携状態を確認できませんでした。時間をおいて再試行してください。",
      };
    }
    if (!ownsSource || !ownsTarget) {
      return { ok: false, message: "自分に紐づく X ID 同士だけを統合申請できます。" };
    }
  } else {
    // import 済み・承認済みを含め、正本名義が存在するなら既存連携申請にする。
    requestType = canonicalXUserId || existingXUser ? "existing_link" : "new_link";
    try {
      if (await isAuthUserLinkedToXUser(db, authUserId, requestedXUserId)) {
        return { ok: false, message: "この X ID はすでに現在のアカウントに紐づいています。" };
      }
    } catch (error) {
      console.error("[requestXIdLink] account link lookup failed", error);
      return {
        ok: false,
        message: "連携状態を確認できませんでした。時間をおいて再試行してください。",
      };
    }
  }

  const shapeError = validateXIdentityRequestShape({
    requestType,
    requestedXId,
    sourceXUserId,
    targetXUserId: targetXUserId || null,
  });
  if (shapeError) return { ok: false, message: shapeError };

  const requestIdentity = {
    authUserId,
    requestType,
    requestedXId,
    sourceXUserId,
    targetXUserId: targetXUserId || null,
  };
  try {
    const existingPendingId = await findEquivalentPendingRequestId(
      db,
      requestIdentity,
    );
    if (existingPendingId) {
      return { ok: true, message: "同じ内容の申請がすでに承認待ちです。" };
    }
  } catch (error) {
    console.error("[requestXIdLink] pending lookup failed", error);
    return {
      ok: false,
      message: "申請状況を確認できませんでした。時間をおいて再試行してください。",
    };
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
  const mutationStatements: BatchItem<"sqlite">[] = [
    db.run(buildPendingXIdRequestInsert(afterRequest)),
  ];
  const expectedMutationChanges: Array<number | null> = [1];
  const audits: WriteAuditLogInput[] = [{
    table_name: "x_identity_requests",
    target_id: id,
    operation: "CREATE",
    before: null,
    after: { ...afterRequest },
    actor_user_id: authUserId,
    actor_x_user_id: actorXUserId,
    retention_class: "long_audit",
  }];
  let webhookNotification: NotificationOutboxStatement | null = null;
  if (isXIdLinkRequestType(requestType)) {
    try {
      const { buildChannelXIdRequestNotification } = await import(
        "@/lib/notifications/templates/xidChannel"
      );
      const { buildOpsChannelWebhookStatement } = await import(
        "@/lib/notifications/opsWebhook"
      );
      const requester = (
        await db
          .select({ discord_id: users.discord_id })
          .from(users)
          .where(eq(users.id, authUserId))
          .limit(1)
      )[0];
      webhookNotification = await buildOpsChannelWebhookStatement(db, {
        actorUserId: authUserId,
        payload: buildChannelXIdRequestNotification({
          requestId: id,
          requestType,
          requestedXId,
          sourceXUserId,
          targetXUserId: targetXUserId || null,
          requesterUserId: authUserId,
          requesterDiscordId: requester?.discord_id ?? null,
          requestedAt: now,
        }),
        dedupeKey: `xid_request_webhook:${id}`,
      });
    } catch (error) {
      unstable_rethrow(error);
      console.error("[requestXIdLink] ops notification preparation failed", error);
      return {
        ok: false,
        message: "運営通知を準備できませんでした。時間をおいて再試行してください。",
      };
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
        notificationWakeSource: webhookNotification ? "web" : undefined,
      });
      await afterXIdLinkRequestAccepted(db, authUserId, requestType);
      return { ok: true, message: "X ID 申請を受け付けました。" };
    } catch (error) {
      unstable_rethrow(error);
      try {
        const reconciliation = await reconcileRequestPersistence(
          db,
          requestIdentity,
        );
        if (reconciliation.outcome === "accepted") {
          await afterXIdLinkRequestAccepted(db, authUserId, requestType);
          return { ok: true, message: "X ID 申請を受け付けました。" };
        }
        if (reconciliation.outcome === "limit") {
          return {
            ok: false,
            message: "未処理の X ID 申請が多すぎます。処理を待つか、不要な申請を取り下げてください。",
          };
        }
      } catch (reconciliationError) {
        console.error("[requestXIdLink] reconciliation failed", reconciliationError);
      }

      if (attempt === 0 && isRetryableXIdMutationError(error)) {
        continue;
      }
      console.error("[requestXIdLink] mutation failed", error);
      return {
        ok: false,
        message: "申請を保存できませんでした。申請履歴を確認してから再試行してください。",
      };
    }
  }
  return { ok: false, message: "申請を保存できませんでした。" };
}

/** 本人の pending 申請を取り消す（連携・統合・別名）。 */
export async function cancelXIdLinkRequest(formData: FormData): Promise<XIdActionResult> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId, db, actorXUserId } = context;

  const requestId = String(formData.get("request_id") ?? "").trim();
  if (!requestId) return { ok: false, message: "申請 ID がありません。" };

  let request: typeof xIdentityRequests.$inferSelect | undefined;
  try {
    request = (
      await db.select().from(xIdentityRequests).where(eq(xIdentityRequests.id, requestId)).limit(1)
    )[0];
  } catch (error) {
    console.error("[cancelXIdLinkRequest] lookup failed", error);
    return {
      ok: false,
      message: "申請状況を確認できませんでした。時間をおいて再試行してください。",
    };
  }
  if (!request || request.requested_by_auth_user_id !== authUserId) {
    return { ok: false, message: "申請が見つかりません。" };
  }
  if (request.status !== "pending") {
    return processedXIdRequestMessage(request.status, "cancel");
  }
  if (
    request.request_type !== "new_link" &&
    request.request_type !== "existing_link" &&
    request.request_type !== "alias" &&
    request.request_type !== "merge"
  ) {
    return { ok: false, message: "この申請は取り下げできません。" };
  }

  const now = nowUnix();
  const decisionFields = buildXIdentityDecisionFields({
    decidedByAuthUserId: authUserId,
    decisionReason: "申請者による取り下げ",
    decidedAt: now,
  });
  const afterRequest = {
    ...request,
    status: "cancelled" as const,
    updated_at: now,
    ...decisionFields,
  };
  const mutationStatements: BatchItem<"sqlite">[] = [
    db
      .update(xIdentityRequests)
      .set({
        status: "cancelled" as const,
        updated_at: now,
        ...decisionFields,
      })
      .where(
        and(
          eq(xIdentityRequests.id, request.id),
          eq(xIdentityRequests.status, "pending"),
          eq(xIdentityRequests.requested_by_auth_user_id, authUserId),
        )!,
      ),
  ];
  const expectedMutationChanges: Array<number | null> = [1];
  let cancelWebhookNotification: NotificationOutboxStatement | null = null;
  if (
    isXIdLinkRequestType(request.request_type) ||
    request.request_type === "alias"
  ) {
    try {
      const { buildChannelXIdCancelledNotification } = await import(
        "@/lib/notifications/templates/xidChannel"
      );
      const { buildOpsChannelWebhookStatement } = await import(
        "@/lib/notifications/opsWebhook"
      );
      const requester = (
        await db
          .select({ discord_id: users.discord_id })
          .from(users)
          .where(eq(users.id, authUserId))
          .limit(1)
      )[0];
      cancelWebhookNotification = await buildOpsChannelWebhookStatement(db, {
        actorUserId: authUserId,
        payload: buildChannelXIdCancelledNotification({
          requestId: request.id,
          requestType: request.request_type,
          requestedXId: request.requested_x_id,
          sourceXUserId: request.source_x_user_id,
          targetXUserId: request.target_x_user_id,
          requesterUserId: authUserId,
          requesterDiscordId: requester?.discord_id ?? null,
          cancelledAt: now,
        }),
        dedupeKey: `xid_cancel_webhook:${request.id}`,
      });
    } catch (error) {
      unstable_rethrow(error);
      console.error("[cancelXIdLinkRequest] ops notification preparation failed", error);
      return {
        ok: false,
        message: "取消通知を準備できませんでした。時間をおいて再試行してください。",
      };
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
    notificationWakeSource: cancelWebhookNotification
      ? ("web" as const)
      : undefined,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mutateWithAudit(db, mutationInput);
      await runXIdPostCommit("xid.cancelXIdLinkRequest", "revalidate", () => {
        revalidateXIdRequestPaths();
      });
      return { ok: true, message: "申請を取り下げました。" };
    } catch (error) {
      unstable_rethrow(error);
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
          return { ok: false, message: "申請が見つかりません。" };
        }
        if (current.status !== "pending") {
          const result = processedXIdRequestMessage(current.status, "cancel");
          if (result.ok) {
            await runXIdPostCommit("xid.cancelXIdLinkRequest", "revalidate", () => {
              revalidateXIdRequestPaths();
            });
          }
          return result;
        }
      } catch (reconciliationError) {
        console.error("[cancelXIdLinkRequest] reconciliation failed", reconciliationError);
      }
      if (attempt === 0 && isRetryableXIdMutationError(error)) continue;
      console.error("[cancelXIdLinkRequest] mutation failed", error);
      return {
        ok: false,
        message: "申請の取り下げに失敗しました。申請履歴を更新してから再試行してください。",
      };
    }
  }
  return { ok: false, message: "申請の取り下げに失敗しました。" };
}

export async function requestXIdMergeRevert(formData: FormData): Promise<XIdActionResult> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId, actorXUserId } = context;
  const parentRequestId = String(formData.get("parent_request_id") ?? "").trim();
  if (!parentRequestId) return { ok: false, message: "統合申請 ID が必要です。" };

  const db = context.db;
  const parent = (
    await db.select().from(xIdentityRequests).where(eq(xIdentityRequests.id, parentRequestId)).limit(1)
  )[0];
  if (!parent || parent.request_type !== "merge" || parent.status !== "done") {
    return { ok: false, message: "差し戻し可能な統合申請が見つかりません。" };
  }
  const now = nowUnix();
  if (!parent.restore_snapshot_json || !parent.revert_deadline_at || parent.revert_deadline_at < now) {
    return { ok: false, message: "統合の差し戻し期限を過ぎています。" };
  }
  if (!parent.target_x_user_id || !(await isAuthUserLinkedToXUser(db, authUserId, parent.target_x_user_id))) {
    return { ok: false, message: "この統合を差し戻す権限がありません。" };
  }
  const existing = (
    await db
      .select({ id: xIdentityRequests.id })
      .from(xIdentityRequests)
      .where(
        and(
          eq(xIdentityRequests.request_type, "revert_merge"),
          eq(xIdentityRequests.parent_request_id, parentRequestId),
          eq(xIdentityRequests.status, "pending"),
        )!,
      )
      .limit(1)
  )[0];
  if (existing) return { ok: true, message: "差し戻し申請はすでに承認待ちです。" };

  const id = generateId("xrevert");
  const afterRequest = {
    id,
    request_type: "revert_merge" as const,
    requested_by_auth_user_id: authUserId,
    requested_x_id: null,
    source_x_user_id: parent.source_x_user_id,
    target_x_user_id: parent.target_x_user_id,
    parent_request_id: parent.id,
    restore_snapshot_json: parent.restore_snapshot_json,
    revert_deadline_at: parent.revert_deadline_at,
    status: "pending" as const,
    requested_at: now,
    updated_at: now,
  };
  await mutateWithAudit(db, {
    mutationStatements: [db.insert(xIdentityRequests).values(afterRequest)],
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
  });
  revalidateXIdentityPaths(parent.target_x_user_id ?? undefined);
  revalidatePath("/admin/x-id-merges");
  return { ok: true, message: "統合の差し戻し申請を受け付けました。" };
}

export async function updateXIdProfile(formData: FormData): Promise<XIdActionResult> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId } = context;

  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const xName = String(formData.get("x_name") ?? "").trim().slice(0, 80);
  const profileText = String(formData.get("profile_text") ?? "").trim().slice(0, 2000);
  const portfolioContact = normalizePortfolioContact(
    String(formData.get("portfolio_contact") ?? "").slice(0, 1200),
  );
  const youtubeChannelRaw = String(formData.get("youtube_channel_url") ?? "").trim();
  const otherSocialLinksRaw = String(formData.get("other_social_links") ?? "").trim();
  const youtubeChannelUrl = youtubeChannelRaw
    ? normalizeHttpUrl(youtubeChannelRaw, { maxLength: 500 })
    : null;
  const otherSocialLinks = validateSocialLinksJson(otherSocialLinksRaw);

  if (!xUserId) return { ok: false, message: "X ID が必要です。" };
  if (youtubeChannelRaw && !youtubeChannelUrl) {
    return { ok: false, message: "YouTube チャンネル URL が不正です。" };
  }
  if (!otherSocialLinks.ok) {
    return { ok: false, message: otherSocialLinks.message ?? "SNS リンクが不正です。" };
  }

  const db = context.db;
  const linked = await getLinkedXUser(db, xUserId, authUserId);
  if (!linked) return { ok: false, message: "この X ID を編集する権限がありません。" };
  const row = (await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1))[0];
  if (!row) return { ok: false, message: "X ID が見つかりません。" };
  const notApproved = requireApprovedForEdit(row);
  if (notApproved) return notApproved;

  const updateValues = buildXUserProfileUpdate({
    displayName: xName || row.x_name?.trim() || `@${xUserId}`,
    profileText: profileText || null,
    portfolioContact,
    youtubeChannelUrl,
    otherSocialLinks: otherSocialLinks.value,
  });
  const after = { ...row, ...updateValues };
  await mutateWithAudit(db, {
    mutationStatements: [
      db.update(xUsers).set(updateValues).where(expectedRowCondition({ expectedCurrent: row })),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "x_users",
        target_id: row.id,
        operation: "UPDATE",
        before: { ...row },
        after: { ...after },
        actor_user_id: authUserId,
        actor_x_user_id: xUserId,
        retention_class: "long_audit",
      },
    ],
  });
  await enqueueAfterXUserPublicUpdate(db, {
    xUserId,
    reason: "x_user_profile_update",
    requestedByUserId: authUserId,
  });

  revalidateXIdentityPaths(xUserId);
  return { ok: true, message: "X ID のプロフィールを更新しました。" };
}

export async function deleteLinkedXId(formData: FormData): Promise<XIdActionResult> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId } = context;
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!xUserId || confirm !== `DELETE ${xUserId}`) {
    return { ok: false, message: `確認のため DELETE ${xUserId} と入力してください。` };
  }

  const db = context.db;
  const link = (
    await db
      .select()
      .from(xUserAccountLinks)
      .where(
        and(
          eq(xUserAccountLinks.x_user_id, xUserId),
          eq(xUserAccountLinks.auth_user_id, authUserId),
        )!,
      )
      .limit(1)
  )[0];
  if (!link) return { ok: false, message: "この X ID の連携を削除できません。" };

  const assessment = await assessXLinkDeletion(db, authUserId, xUserId, link.link_role);
  if (!assessment.allowed) {
    return { ok: false, message: assessment.message ?? "連携を削除できません。" };
  }

  const beforeUser = (
    await db.select().from(users).where(eq(users.id, authUserId)).limit(1)
  )[0];
  if (!beforeUser) return { ok: false, message: "ユーザーが見つかりません。" };
  const mutationStatements: BatchItem<"sqlite">[] = [
    db.run(sql`
      DELETE FROM x_user_account_links
      WHERE x_user_id = ${xUserId}
        AND auth_user_id = ${authUserId}
        AND (${xLinkDeletionAllowedSql(authUserId, xUserId)})
    `),
  ];
  const expectedMutationChanges: Array<number | null> = [1];
  const audits: WriteAuditLogInput[] = [
    {
      table_name: "x_user_account_links",
      target_id: `${xUserId}:${authUserId}`,
      operation: "DELETE",
      before: { ...link },
      after: null,
      actor_user_id: authUserId,
      actor_x_user_id: xUserId,
      retention_class: "long_audit",
    },
  ];
  if (normalizeXId(beforeUser.active_x_user_id) === xUserId) {
    const afterUser = { ...beforeUser, active_x_user_id: null };
    mutationStatements.push(
      db
        .update(users)
        .set({ active_x_user_id: null })
        .where(expectedRowCondition({ expectedCurrent: beforeUser })),
    );
    expectedMutationChanges.push(1);
    audits.push({
      table_name: "user",
      target_id: authUserId,
      operation: "UPDATE",
      before: { ...beforeUser },
      after: { ...afterUser },
      actor_user_id: authUserId,
      actor_x_user_id: xUserId,
      retention_class: "long_audit",
    });
  }
  await mutateWithAudit(db, { mutationStatements, expectedMutationChanges, audits });
  revalidateXIdentityPaths(xUserId);
  return { ok: true, message: "現在の認証アカウントとの X ID 連携を削除しました。" };
}

export async function setXIdIcon(formData: FormData): Promise<XIdActionResult> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId } = context;
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const iconUrl = String(formData.get("icon_url") ?? "").trim();
  if (!xUserId || !iconUrl) return { ok: false, message: "X ID とアイコンが必要です。" };

  const db = context.db;
  if (!(await getLinkedXUser(db, xUserId, authUserId))) {
    return { ok: false, message: "この X ID を編集する権限がありません。" };
  }
  const row = (await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1))[0];
  if (!row) return { ok: false, message: "X ID が見つかりません。" };
  const notApproved = requireApprovedForEdit(row);
  if (notApproved) return notApproved;
  const candidates = await getXIconCandidates(db, xUserId, 40);
  if (!candidates.includes(iconUrl)) return { ok: false, message: "選択できないアイコンです。" };

  const oldIconUrl = row.icon_url;
  const after = { ...row, icon_url: iconUrl };
  await mutateWithAudit(db, {
    mutationStatements: [
      db.update(xUsers).set({ icon_url: iconUrl }).where(expectedRowCondition({ expectedCurrent: row })),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "x_users",
        target_id: row.id,
        operation: "UPDATE",
        before: { ...row },
        after: { ...after },
        actor_user_id: authUserId,
        actor_x_user_id: xUserId,
        reason: "icon_select",
        retention_class: "long_audit",
      },
    ],
  });
  const env = getEnv();
  await runXIdPostCommit("xid.setXIdIcon", "static_rebuild_enqueue", async () => {
    await enqueueAfterXUserPublicUpdate(db, {
      xUserId,
      reason: "x_user_icon_update",
      requestedByUserId: authUserId,
    });
  });
  if (env.BUCKET) {
    await runXIdPostCommit("xid.setXIdIcon", "orphan_icon_cleanup", async () => {
      await tryDeleteUnreferencedIcon(db.$client, env.BUCKET, oldIconUrl, iconUrl);
    });
  }
  revalidateXIdentityPaths(xUserId);
  return { ok: true, message: "アイコンを更新しました。" };
}

export async function uploadXIdIcon(
  formData: FormData,
): Promise<XIdActionResult & { iconUrl?: string }> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId } = context;
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const file = formData.get("icon_file");
  if (!xUserId || !(file instanceof File)) return { ok: false, message: "画像ファイルが必要です。" };

  const db = context.db;
  if (!(await getLinkedXUser(db, xUserId, authUserId))) {
    return { ok: false, message: "この X ID を編集する権限がありません。" };
  }
  const row = (await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1))[0];
  if (!row) return { ok: false, message: "X ID が見つかりません。" };
  const notApproved = requireApprovedForEdit(row);
  if (notApproved) return notApproved;

  const env = getEnv();
  if (!env.BUCKET) return { ok: false, message: "ストレージが利用できません。" };
  const traceId = createTraceId();
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (error) {
    unstable_rethrow(error);
    console.error("[uploadXIdIcon] file read failed", { traceId, error });
    return { ok: false, message: "画像の読み込みに失敗しました。再度お試しください。" };
  }
  const validated = validateIconImageUpload({
    buffer,
    declaredType: file.type,
  });
  if (!validated.ok) return { ok: false, message: validated.message };
  const { image } = validated;

  const oldIconUrl = row.icon_url;
  const objectId = generateId("xicon");
  const stagingKey = `xicons/staging/${authUserId}/${objectId}.${image.ext}`;
  const key = `xicons/${xUserId}/${objectId}.${image.ext}`;
  const iconUrl = `/api/media/${key}`;
  const after = { ...row, icon_url: iconUrl };
  let dbCommitted = false;
  try {
    await env.BUCKET.put(stagingKey, buffer, { httpMetadata: { contentType: image.contentType } });
    await env.BUCKET.put(key, buffer, { httpMetadata: { contentType: image.contentType } });
    await mutateWithAudit(db, {
      mutationStatements: [
        db.update(xUsers).set({ icon_url: iconUrl }).where(expectedRowCondition({ expectedCurrent: row })),
      ],
      expectedMutationChanges: [1],
      audits: [
        {
          table_name: "x_users",
          target_id: row.id,
          operation: "UPDATE",
          before: { ...row },
          after: { ...after },
          actor_user_id: authUserId,
          actor_x_user_id: xUserId,
          reason: "icon_upload",
          retention_class: "long_audit",
        },
      ],
    });
    dbCommitted = true;
  } catch (error) {
    unstable_rethrow(error);
    // DB 反映前の失敗だけ新規 R2 を削除する。DB 成功後に正式キーを消すと死リンクになる。
    if (!dbCommitted) {
      await Promise.allSettled([env.BUCKET.delete(stagingKey), env.BUCKET.delete(key)]);
    }
    console.error("[uploadXIdIcon] persist failed", { traceId, error });
    return { ok: false, message: "アイコンのアップロードに失敗しました。時間をおいて再試行してください。" };
  }
  await env.BUCKET.delete(stagingKey).catch((error) => {
    console.warn("[uploadXIdIcon] staging cleanup failed", { traceId, error });
  });
  await runXIdPostCommit("xid.uploadXIdIcon", "static_rebuild_enqueue", async () => {
    await enqueueAfterXUserPublicUpdate(db, {
      xUserId,
      reason: "x_user_icon_update",
      requestedByUserId: authUserId,
    });
  });
  await runXIdPostCommit("xid.uploadXIdIcon", "orphan_icon_cleanup", async () => {
    await tryDeleteUnreferencedIcon(db.$client, env.BUCKET, oldIconUrl, iconUrl);
  });
  revalidateXIdentityPaths(xUserId);
  return { ok: true, message: "アイコンをアップロードしました。", iconUrl };
}
