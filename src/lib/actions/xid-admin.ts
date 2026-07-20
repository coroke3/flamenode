"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { canManageXIdLinkRequests } from "@/lib/auth/ownership";
import { getDatabase } from "@/lib/cloudflare";
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
import { isAuthUserLinkedToXUser } from "@/lib/auth/xIdentity";
import { validateXIdentityRequestShape } from "@/lib/auth/xIdentityRequestCore";

export interface XIdAdminResult {
  ok: boolean;
  message?: string;
}

type DB = NonNullable<ReturnType<typeof getDatabase>>;

async function getXIdLinkOperator(): Promise<{ authUserId: string; db: DB } | null> {
  const session = await auth().catch(() => null);
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id) return null;
  const db = getDatabase();
  if (!db) return null;
  const allowed = await canManageXIdLinkRequests(db, {
    id: user.id,
    role: user.role ?? null,
  });
  return allowed ? { authUserId: user.id, db } : null;
}

function revalidateIdentityAdminPaths(): void {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  revalidatePath("/admin/x-link-requests");
  revalidatePath("/manage/x-link-requests");
  revalidatePath("/admin/users");
}

export async function approveXIdLinkRequest(formData: FormData): Promise<XIdAdminResult> {
  const operator = await getXIdLinkOperator();
  if (!operator) return { ok: false, message: "X ID 申請を処理する権限がありません。" };
  const requestId = String(formData.get("request_id") ?? "").trim();
  if (!requestId) return { ok: false, message: "申請 ID がありません。" };

  const { db, authUserId: operatorAuthUserId } = operator;
  const request = (
    await db.select().from(xIdentityRequests).where(eq(xIdentityRequests.id, requestId)).limit(1)
  )[0];
  if (!request) return { ok: false, message: "申請が見つかりません。" };
  if (request.status !== "pending") return { ok: false, message: "すでに処理済みの申請です。" };
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
  const requestedXUserId = normalizeXId(request.requested_x_id);
  const now = Math.floor(Date.now() / 1000);
  const statements: BatchItem<"sqlite">[] = [];
  const expected: Array<number | null> = [];
  const audits: WriteAuditLogInput[] = [];

  if (request.request_type === "alias") {
    const targetXUserId = normalizeXId(request.target_x_user_id);
    if (!requestedXUserId || !targetXUserId) {
      return { ok: false, message: "別名申請の X ID が不足しています。" };
    }
    const target = (await db.select().from(xUsers).where(eq(xUsers.id, targetXUserId)).limit(1))[0];
    if (!target) return { ok: false, message: "別名の追加先 X ID が見つかりません。" };
    if (!(await isAuthUserLinkedToXUser(db, requestedAuthUserId, targetXUserId))) {
      return { ok: false, message: "申請者は追加先 X ID に紐づいていません。" };
    }
    const existingX = (await db.select({ id: xUsers.id }).from(xUsers).where(eq(xUsers.id, requestedXUserId)).limit(1))[0];
    if (existingX) return { ok: false, message: "別名 X ID はすでに X名義として登録されています。" };
    const existingAlias = (
      await db
        .select()
        .from(xUserAliases)
        .where(
          and(
            eq(xUserAliases.x_user_id, targetXUserId),
            eq(xUserAliases.alias_x_id, requestedXUserId),
          )!,
        )
        .limit(1)
    )[0];
    if (!existingAlias) {
      const alias = { x_user_id: targetXUserId, alias_x_id: requestedXUserId };
      statements.push(db.insert(xUserAliases).values(alias));
      expected.push(1);
      audits.push({
        table_name: "x_user_aliases",
        target_id: `${targetXUserId}:${requestedXUserId}`,
        operation: "CREATE",
        before: null,
        after: alias,
        actor_user_id: operatorAuthUserId,
        retention_class: "long_audit",
      });
    }
  } else {
    if (!requestedXUserId) return { ok: false, message: "申請 X ID がありません。" };
    const xUser = (await db.select().from(xUsers).where(eq(xUsers.id, requestedXUserId)).limit(1))[0];
    if (request.request_type === "new_link" && xUser) {
      return { ok: false, message: "新規申請の X ID はすでに存在します。既存連携として再申請してください。" };
    }
    if (request.request_type === "existing_link" && !xUser) {
      return { ok: false, message: "既存連携申請の X ID が見つかりません。" };
    }
    const duplicateLink = (
      await db
        .select()
        .from(xUserAccountLinks)
        .where(
          and(
            eq(xUserAccountLinks.x_user_id, requestedXUserId),
            eq(xUserAccountLinks.auth_user_id, requestedAuthUserId),
          )!,
        )
        .limit(1)
    )[0];
    if (duplicateLink) {
      return { ok: false, message: "同一の X名義と認証ユーザーの組合せはすでに登録されています。" };
    }

    if (!xUser) {
      const newXUser = {
        id: requestedXUserId,
        x_name: `@${requestedXUserId}`,
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
        target_id: requestedXUserId,
        operation: "CREATE",
        before: null,
        after: newXUser,
        actor_user_id: operatorAuthUserId,
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
        target_id: requestedXUserId,
        operation: "UPDATE",
        before: { ...xUser },
        after: afterXUser,
        actor_user_id: operatorAuthUserId,
        retention_class: "long_audit",
      });
    }

    const link = {
      x_user_id: requestedXUserId,
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
      target_id: `${requestedXUserId}:${requestedAuthUserId}`,
      operation: "CREATE",
      before: null,
      after: link,
      actor_user_id: operatorAuthUserId,
      retention_class: "long_audit",
    });

    const authUser = (
      await db.select().from(users).where(eq(users.id, requestedAuthUserId)).limit(1)
    )[0];
    if (authUser && !authUser.active_x_user_id) {
      const afterUser = { ...authUser, active_x_user_id: requestedXUserId };
      statements.push(
        db
          .update(users)
          .set({ active_x_user_id: requestedXUserId })
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
        retention_class: "long_audit",
      });
    }
  }

  const afterRequest = { ...request, status: "approved" as const, updated_at: now };
  statements.push(
    db
      .update(xIdentityRequests)
      .set({ status: "approved", updated_at: now })
      .where(expectedRowCondition({ expectedCurrent: request })),
  );
  expected.push(1);
  audits.push({
    table_name: "x_identity_requests",
    target_id: request.id,
    operation: "UPDATE",
    before: { ...request },
    after: afterRequest,
    actor_user_id: operatorAuthUserId,
    retention_class: "long_audit",
  });

  const notification = await buildNotificationOutboxStatement(db, {
    recipientUserId: requestedAuthUserId,
    type: request.request_type === "alias" ? "x_id_alias_approved" : "x_id_approved",
    payload: {
      content:
        request.request_type === "alias"
          ? `X ID @${requestedXUserId} の別名追加が承認されました。`
          : `X ID @${requestedXUserId} の連携申請が承認されました。`,
      x_user_id: request.target_x_user_id ?? requestedXUserId,
      request_id: request.id,
    },
  });
  if (notification) {
    statements.push(notification);
    expected.push(1);
  }

  await mutateWithAudit(db, {
    mutationStatements: statements,
    expectedMutationChanges: expected,
    audits,
  });
  revalidateIdentityAdminPaths();
  return { ok: true, message: request.request_type === "alias" ? "別名を承認しました。" : "連携を承認しました。" };
}

export async function rejectXIdLinkRequest(formData: FormData): Promise<XIdAdminResult> {
  const operator = await getXIdLinkOperator();
  if (!operator) return { ok: false, message: "X ID 申請を処理する権限がありません。" };
  const requestId = String(formData.get("request_id") ?? "").trim();
  if (!requestId) return { ok: false, message: "申請 ID がありません。" };
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  const { db, authUserId: operatorAuthUserId } = operator;
  const request = (
    await db.select().from(xIdentityRequests).where(eq(xIdentityRequests.id, requestId)).limit(1)
  )[0];
  if (!request) return { ok: false, message: "申請が見つかりません。" };
  if (request.status !== "pending") return { ok: false, message: "すでに処理済みの申請です。" };
  if (request.request_type === "merge" || request.request_type === "revert_merge") {
    return { ok: false, message: "統合・差し戻し申請は X ID 統合管理で処理してください。" };
  }

  const now = Math.floor(Date.now() / 1000);
  const afterRequest = { ...request, status: "rejected" as const, updated_at: now };
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
  });
  const statements: BatchItem<"sqlite">[] = [
    db
      .update(xIdentityRequests)
      .set({ status: "rejected", updated_at: now })
      .where(expectedRowCondition({ expectedCurrent: request })),
  ];
  const expected: Array<number | null> = [1];
  if (notification) {
    statements.push(notification);
    expected.push(1);
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
        reason: reason || null,
        retention_class: "long_audit",
      },
    ],
  });
  revalidateIdentityAdminPaths();
  return { ok: true, message: "却下しました。" };
}
