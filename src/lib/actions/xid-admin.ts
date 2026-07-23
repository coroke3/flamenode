"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq, inArray, ne } from "drizzle-orm";
import { canManageXIdLinkRequests } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import type { DB } from "@/lib/db/client";
import {
  users,
  xIdentityRequests,
  xUserAccountLinks,
  xUserAliases,
  xUsers,
} from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import type { BatchItem } from "drizzle-orm/batch";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import {
  isAuthUserLinkedToXUser,
  resolveCanonicalXUserId,
} from "@/lib/auth/xIdentity";
import { validateXIdentityRequestShape } from "@/lib/auth/xIdentityRequestCore";
import {
  isRetryableXIdMutationError,
  processedXIdRequestMessage,
} from "@/lib/actions/xidRequestReliabilityCore";

export interface XIdAdminResult {
  ok: boolean;
  message?: string;
}

type XIdLinkOperatorResult =
  | { ok: true; authUserId: string; db: DB }
  | { ok: false; message: string };
type XIdLinkOperator = Extract<XIdLinkOperatorResult, { ok: true }>;

async function getXIdLinkOperator(): Promise<XIdLinkOperatorResult> {
  try {
    const guard = await writeGuard({ feature: "xid_links" });
    if (!guard.ok) return { ok: false, message: guard.message };
    const { db, user } = guard;
    const allowed = await canManageXIdLinkRequests(db, {
      id: user.id,
      role: user.role,
    });
    return allowed
      ? { ok: true, authUserId: user.id, db }
      : { ok: false, message: "X ID 申請を処理する権限がありません。" };
  } catch (error) {
    // redirect/notFound 等のNext.js制御例外はAction結果へ変換しない。
    unstable_rethrow(error);
    console.error("[xid-admin] operator context unavailable", error);
    return {
      ok: false,
      message: "認証またはDBに接続できません。時間をおいて再試行してください。",
    };
  }
}

function revalidateIdentityAdminPaths(): void {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  revalidatePath("/admin/x-link-requests");
  revalidatePath("/manage/x-link-requests");
  revalidatePath("/admin/users");
}

function mutationError(error: unknown): XIdAdminResult {
  console.error("[xid-admin] mutation failed", error);
  return {
    ok: false,
    message: "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。",
  };
}

async function approveXIdLinkRequestOnce(
  operator: XIdLinkOperator,
  requestId: string,
): Promise<XIdAdminResult> {
  const { db, authUserId: operatorAuthUserId } = operator;
  const request = (
    await db.select().from(xIdentityRequests).where(eq(xIdentityRequests.id, requestId)).limit(1)
  )[0];
  if (!request) return { ok: false, message: "申請が見つかりません。" };
  if (request.status !== "pending") {
    return processedXIdRequestMessage(request.status, "approve");
  }
  if (request.request_type === "merge" || request.request_type === "revert_merge") {
    return { ok: false, message: "統合・差し戻し申請は X ID 統合管理で処理してください。" };
  }

  const shapeError = validateXIdentityRequestShape({
    requestType: request.request_type,
    requestedXId: request.requested_x_id,
    sourceXUserId: request.source_x_user_id,
    targetXUserId: request.target_x_user_id,
    parentRequestId: request.parent_request_id,
    restoreSnapshotJson: request.restore_snapshot_json,
    revertDeadlineAt: request.revert_deadline_at,
  });
  if (shapeError) return { ok: false, message: shapeError };

  const requestedAuthUserId = request.requested_by_auth_user_id;
  const submittedXUserId = normalizeXId(request.requested_x_id);
  const now = Math.floor(Date.now() / 1000);
  const statements: BatchItem<"sqlite">[] = [];
  const expected: Array<number | null> = [];
  const audits: WriteAuditLogInput[] = [];
  let notificationXUserId: string | null = null;

  if (request.request_type === "alias") {
    const targetXUserId = await resolveCanonicalXUserId(db, request.target_x_user_id);
    if (!submittedXUserId || !targetXUserId) {
      return { ok: false, message: "別名申請のX IDまたは追加先が不足しています。" };
    }
    if (!(await isAuthUserLinkedToXUser(db, requestedAuthUserId, targetXUserId))) {
      return { ok: false, message: "申請者は追加先 X ID に紐づいていません。" };
    }
    const existingCanonical = await resolveCanonicalXUserId(db, submittedXUserId);
    if (existingCanonical) {
      return { ok: false, message: `@${submittedXUserId} はすでに @${existingCanonical} として登録されています。` };
    }
    const existingAlias = (
      await db
        .select()
        .from(xUserAliases)
        .where(
          and(
            eq(xUserAliases.x_user_id, targetXUserId),
            eq(xUserAliases.alias_x_id, submittedXUserId),
          )!,
        )
        .limit(1)
    )[0];
    if (!existingAlias) {
      const alias = { x_user_id: targetXUserId, alias_x_id: submittedXUserId };
      statements.push(db.insert(xUserAliases).values(alias));
      expected.push(1);
      audits.push({
        table_name: "x_user_aliases",
        target_id: `${targetXUserId}:${submittedXUserId}`,
        operation: "CREATE",
        before: null,
        after: alias,
        actor_user_id: operatorAuthUserId,
        reason: "X名義の別名申請を承認",
        context: "x-identity-request",
        retention_class: "long_audit",
      });
    }
    notificationXUserId = targetXUserId;
  } else {
    if (!submittedXUserId) return { ok: false, message: "申請 X ID がありません。" };
    const canonicalXUserId = await resolveCanonicalXUserId(db, submittedXUserId);
    const effectiveXUserId = canonicalXUserId ?? submittedXUserId;
    // rejected行はcanonical resolverでは無効扱いだが、再申請の承認時には
    // 同じ主キーをINSERTせず既存行をapprovedへ戻す必要がある。
    const xUser = (
      await db.select().from(xUsers).where(eq(xUsers.id, effectiveXUserId)).limit(1)
    )[0] ?? null;

    // new_link 申請後に import 等で x_users が先に存在した場合は、
    // 再申請を要求せず既存連携として承認する（imported / approved を含む）。
    if (request.request_type === "existing_link" && !xUser) {
      return { ok: false, message: "既存連携申請の X ID が見つからないか、統合済みで無効です。" };
    }
    const duplicateLink = (
      await db
        .select()
        .from(xUserAccountLinks)
        .where(
          and(
            eq(xUserAccountLinks.x_user_id, effectiveXUserId),
            eq(xUserAccountLinks.auth_user_id, requestedAuthUserId),
          )!,
        )
        .limit(1)
    )[0];
    if (!xUser) {
      const newXUser = {
        id: effectiveXUserId,
        x_name: `@${effectiveXUserId}`,
        icon_url: null,
        profile_text: null,
        portfolio_contact: null,
        youtube_channel_url: null,
        other_social_links: null,
        creative_start_date: null,
        approval_status: "approved" as const,
      };
      statements.push(db.insert(xUsers).values(newXUser));
      expected.push(1);
      audits.push({
        table_name: "x_users",
        target_id: effectiveXUserId,
        operation: "CREATE",
        before: null,
        after: newXUser,
        actor_user_id: operatorAuthUserId,
        reason: "新規X名義申請を承認",
        context: "x-identity-request",
        retention_class: "long_audit",
      });
    } else if (xUser.approval_status !== "approved") {
      const afterXUser = { ...xUser, approval_status: "approved" as const };
      statements.push(
        db
          .update(xUsers)
          .set({ approval_status: "approved" })
          .where(expectedRowCondition({ expectedCurrent: xUser })),
      );
      expected.push(1);
      audits.push({
        table_name: "x_users",
        target_id: effectiveXUserId,
        operation: "UPDATE",
        before: { ...xUser },
        after: afterXUser,
        actor_user_id: operatorAuthUserId,
        reason: "既存X名義の連携申請を承認",
        context: "x-identity-request",
        retention_class: "long_audit",
      });
    }

    if (!duplicateLink) {
      const link = {
        x_user_id: effectiveXUserId,
        auth_user_id: requestedAuthUserId,
        link_role: "owner" as const,
        created_by_request_id: request.id,
        created_at: now,
        updated_at: now,
      };
      statements.push(db.insert(xUserAccountLinks).values(link));
      expected.push(1);
      audits.push({
        table_name: "x_user_account_links",
        target_id: `${effectiveXUserId}:${requestedAuthUserId}`,
        operation: "CREATE",
        before: null,
        after: link,
        actor_user_id: operatorAuthUserId,
        reason: "X名義と認証ユーザーを連携",
        context: "x-identity-request",
        retention_class: "long_audit",
      });
    }

    const authUser = (
      await db.select().from(users).where(eq(users.id, requestedAuthUserId)).limit(1)
    )[0];
    if (authUser && !authUser.active_x_user_id) {
      const afterUser = { ...authUser, active_x_user_id: effectiveXUserId };
      statements.push(
        db
          .update(users)
          .set({ active_x_user_id: effectiveXUserId })
          .where(expectedRowCondition({ expectedCurrent: authUser })),
      );
      expected.push(1);
      audits.push({
        table_name: "user",
        target_id: requestedAuthUserId,
        operation: "UPDATE",
        before: { ...authUser },
        after: afterUser,
        actor_user_id: operatorAuthUserId,
        reason: "初回連携X名義をアクティブに設定",
        context: "x-identity-request",
        retention_class: "normal",
      });
    }
    notificationXUserId = effectiveXUserId;

    const siblingPendings = await db
      .select()
      .from(xIdentityRequests)
      .where(
        and(
          eq(xIdentityRequests.requested_by_auth_user_id, requestedAuthUserId),
          eq(xIdentityRequests.requested_x_id, submittedXUserId),
          eq(xIdentityRequests.status, "pending"),
          ne(xIdentityRequests.id, request.id),
          inArray(xIdentityRequests.request_type, ["new_link", "existing_link"]),
        )!,
      );
    for (const sibling of siblingPendings) {
      const afterSibling = { ...sibling, status: "cancelled" as const, updated_at: now };
      statements.push(
        db
          .update(xIdentityRequests)
          .set({ status: "cancelled", updated_at: now })
          .where(
            and(
              eq(xIdentityRequests.id, sibling.id),
              eq(xIdentityRequests.status, "pending"),
            )!,
          ),
      );
      expected.push(1);
      audits.push({
        table_name: "x_identity_requests",
        target_id: sibling.id,
        operation: "UPDATE",
        before: { ...sibling },
        after: afterSibling,
        actor_user_id: operatorAuthUserId,
        reason: "同一X IDの重複pending申請を取り消す",
        context: "x-identity-request",
        retention_class: "long_audit",
      });
    }
  }

  const afterRequest = { ...request, status: "approved" as const, updated_at: now };
  statements.push(
    db
      .update(xIdentityRequests)
      .set({ status: "approved", updated_at: now })
      .where(
        and(
          eq(xIdentityRequests.id, request.id),
          eq(xIdentityRequests.status, "pending"),
        )!,
      ),
  );
  expected.push(1);
  audits.push({
    table_name: "x_identity_requests",
    target_id: request.id,
    operation: "UPDATE",
    before: { ...request },
    after: afterRequest,
    actor_user_id: operatorAuthUserId,
    reason: "X ID申請を承認",
    context: "x-identity-request",
    retention_class: "long_audit",
  });

  const notification = await buildNotificationOutboxStatement(db, {
    recipientUserId: requestedAuthUserId,
    type: request.request_type === "alias" ? "x_id_alias_approved" : "x_id_approved",
    payload: {
      content:
        request.request_type === "alias"
          ? `X ID @${submittedXUserId} の別名追加が承認されました。`
          : `X ID @${notificationXUserId} の連携申請が承認されました。`,
      x_user_id: notificationXUserId,
      request_id: request.id,
    },
    dedupeKey: `xid_approved:${request.id}`,
  });
  if (notification) {
    statements.push(notification.statement);
    expected.push(null);
  }

  await mutateWithAudit(db, {
    mutationStatements: statements,
    expectedMutationChanges: expected,
    audits,
    notificationWakeSource: notification ? "admin" : undefined,
  });
  revalidateIdentityAdminPaths();
  return { ok: true, message: request.request_type === "alias" ? "別名を承認しました。" : "連携を承認しました。" };
}

export async function approveXIdLinkRequest(formData: FormData): Promise<XIdAdminResult> {
  const operator = await getXIdLinkOperator();
  if (!operator.ok) return { ok: false, message: operator.message };
  const requestId = String(formData.get("request_id") ?? "").trim();
  if (!requestId) return { ok: false, message: "申請 ID がありません。" };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await approveXIdLinkRequestOnce(operator, requestId);
    } catch (error) {
      try {
        const current = (
          await operator.db
            .select({ status: xIdentityRequests.status })
            .from(xIdentityRequests)
            .where(eq(xIdentityRequests.id, requestId))
            .limit(1)
        )[0];
        if (!current) return { ok: false, message: "申請が見つかりません。" };
        if (current.status !== "pending") {
          const result = processedXIdRequestMessage(current.status, "approve");
          if (result.ok) revalidateIdentityAdminPaths();
          return result;
        }
      } catch (reconciliationError) {
        console.error("[xid-admin] approval reconciliation failed", reconciliationError);
      }
      if (attempt === 0 && isRetryableXIdMutationError(error)) continue;
      return mutationError(error);
    }
  }
  return { ok: false, message: "承認を完了できませんでした。再読み込みしてお試しください。" };
}

async function rejectXIdLinkRequestOnce(
  operator: XIdLinkOperator,
  requestId: string,
  reason: string,
): Promise<XIdAdminResult> {
  const { db, authUserId: operatorAuthUserId } = operator;
  const request = (
    await db.select().from(xIdentityRequests).where(eq(xIdentityRequests.id, requestId)).limit(1)
  )[0];
  if (!request) return { ok: false, message: "申請が見つかりません。" };
  if (request.status !== "pending") {
    return processedXIdRequestMessage(request.status, "reject");
  }
  if (request.request_type === "merge" || request.request_type === "revert_merge") {
    return { ok: false, message: "統合・差し戻し申請は X ID 統合管理で処理してください。" };
  }

  const now = Math.floor(Date.now() / 1000);
  const afterRequest = { ...request, status: "rejected" as const, updated_at: now };
  const rejectedXIdLabel =
    request.requested_x_id ?? request.source_x_user_id ?? "不明";
  const notification = await buildNotificationOutboxStatement(db, {
    recipientUserId: request.requested_by_auth_user_id,
    type: "x_id_rejected",
    payload: {
      content: reason
        ? `X ID 申請が却下されました。理由: ${reason}`
        : "X ID 申請が却下されました。",
      requested_x_id: request.requested_x_id,
      request_id: request.id,
      reason: reason || null,
    },
    dedupeKey: `xid_rejected:${request.id}`,
  });
  const webhookNotification = await buildNotificationOutboxStatement(db, {
    recipientUserId: request.requested_by_auth_user_id,
    type: "discord_webhook",
    payload: {
      content: reason
        ? `X ID拒否: @${rejectedXIdLabel} / request=${request.id} / 理由: ${reason}`
        : `X ID拒否: @${rejectedXIdLabel} / request=${request.id}`,
    },
    dedupeKey: `xid_reject_webhook:${request.id}`,
    force: true,
  });
  const statements: BatchItem<"sqlite">[] = [
    db
      .update(xIdentityRequests)
      .set({ status: "rejected", updated_at: now })
      .where(
        and(
          eq(xIdentityRequests.id, request.id),
          eq(xIdentityRequests.status, "pending"),
        )!,
      ),
  ];
  const expected: Array<number | null> = [1];
  if (notification) {
    statements.push(notification.statement);
    expected.push(null);
  }
  if (webhookNotification) {
    statements.push(webhookNotification.statement);
    expected.push(null);
  }
  await mutateWithAudit(db, {
    mutationStatements: statements,
    expectedMutationChanges: expected,
    audits: [
      {
        table_name: "x_identity_requests",
        target_id: request.id,
        operation: "UPDATE",
        before: { ...request },
        after: afterRequest,
        actor_user_id: operatorAuthUserId,
        reason: reason || "X ID申請を却下",
        context: "x-identity-request",
        retention_class: "long_audit",
      },
    ],
    notificationWakeSource:
      notification || webhookNotification ? "admin" : undefined,
  });
  revalidateIdentityAdminPaths();
  return { ok: true, message: "却下しました。" };
}

export async function rejectXIdLinkRequest(formData: FormData): Promise<XIdAdminResult> {
  const operator = await getXIdLinkOperator();
  if (!operator.ok) return { ok: false, message: operator.message };
  const requestId = String(formData.get("request_id") ?? "").trim();
  if (!requestId) return { ok: false, message: "申請 ID がありません。" };
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await rejectXIdLinkRequestOnce(operator, requestId, reason);
    } catch (error) {
      try {
        const current = (
          await operator.db
            .select({ status: xIdentityRequests.status })
            .from(xIdentityRequests)
            .where(eq(xIdentityRequests.id, requestId))
            .limit(1)
        )[0];
        if (!current) return { ok: false, message: "申請が見つかりません。" };
        if (current.status !== "pending") {
          const result = processedXIdRequestMessage(current.status, "reject");
          if (result.ok) revalidateIdentityAdminPaths();
          return result;
        }
      } catch (reconciliationError) {
        console.error("[xid-admin] rejection reconciliation failed", reconciliationError);
      }
      if (attempt === 0 && isRetryableXIdMutationError(error)) continue;
      return mutationError(error);
    }
  }
  return { ok: false, message: "却下を完了できませんでした。再読み込みしてお試しください。" };
}
