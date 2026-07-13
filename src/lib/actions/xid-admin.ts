"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { canManageXIdLinkRequests } from "@/lib/auth/ownership";
import { getDatabase } from "@/lib/cloudflare";
import {
  users,
  xAccountLinkRequests,
  xUserAliases,
  xUsers,
} from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import type { BatchItem } from "drizzle-orm/batch";
import type { WriteAuditLogInput } from "@/lib/audit/types";

export interface XIdAdminResult {
  ok: boolean;
  message?: string;
}

type DB = NonNullable<ReturnType<typeof getDatabase>>;

async function getXIdLinkOperator(): Promise<{ userId: string; db: DB } | null> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) return null;
  const db = getDatabase();
  if (!db) return null;
  const ok = await canManageXIdLinkRequests(db, {
    id: u.id,
    role: u.role ?? null,
  });
  if (!ok) return null;
  return { userId: u.id, db };
}

function xUserIdMatches(xUserId: string) {
  return sql`lower(${xUsers.id}) = ${normalizeXId(xUserId)}`;
}

/**
 * X ID 連携申請を承認し、`x_users` を作成または更新する。
 */
export async function approveXIdLinkRequest(
  formData: FormData,
): Promise<XIdAdminResult> {
  const operator = await getXIdLinkOperator();
  const adminId = operator?.userId ?? null;
  if (!adminId) return { ok: false, message: "X ID 連携申請を処理する権限がありません。" };

  const requestId = String(formData.get("request_id") ?? "").trim();
  if (!requestId) return { ok: false, message: "申請 ID がありません。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const reqRow = (
    await db
      .select()
      .from(xAccountLinkRequests)
      .where(eq(xAccountLinkRequests.id, requestId))
      .limit(1)
  )[0];
  if (!reqRow) return { ok: false, message: "申請が見つかりません。" };
  if (reqRow.status !== "pending") {
    return { ok: false, message: "すでに処理済みの申請です。" };
  }

  const xid = normalizeXId(reqRow.requested_x_id);
  const userId = reqRow.user_id;
  const now = Math.floor(Date.now() / 1000);
  const linkType = reqRow.link_type ?? "new";

  // ============================
  // link_type === "alias": x_user_aliases に行追加して終了。
  // 既存の target_x_user_id を主、申請された requested_x_id を別名として登録する。
  // x_users への新規行は作らない。投稿主体権限は target_x_user_id 側のまま。
  // ============================
  if (linkType === "alias") {
    const targetXId = reqRow.target_x_user_id
      ? normalizeXId(reqRow.target_x_user_id)
      : null;
    if (!targetXId) {
      return { ok: false, message: "alias 申請には target_x_user_id が必要です。" };
    }
    const targetRow = (
      await db.select().from(xUsers).where(xUserIdMatches(targetXId)).limit(1)
    )[0];
    if (!targetRow) {
      return { ok: false, message: "target_x_user_id が見つかりません。" };
    }
    if (
      targetRow.linked_user_id &&
      targetRow.linked_user_id !== userId
    ) {
      return {
        ok: false,
        message: "target_x_user_id が別ユーザーに紐づいているため alias 追加できません。",
      };
    }
    const existingAlias = (await db.select().from(xUserAliases).where(and(
      eq(xUserAliases.x_user_id, targetXId), eq(xUserAliases.alias_x_id, xid),
    )!).limit(1))[0];
    const notification = await buildNotificationOutboxStatement(db, {
      recipientUserId: userId,
      type: "x_id_alias_approved",
      payload: {
        content: `X ID @${xid} を @${targetXId} の別名として承認しました。`,
        x_user_id: targetXId,
        alias_x_id: xid,
        request_id: requestId,
      },
    });
    const afterRequest = { ...reqRow, status: "approved" as const };
    const statements: BatchItem<"sqlite">[] = [];
    const expected: Array<number | null> = [];
    const audits: WriteAuditLogInput[] = [];
    if (!existingAlias) {
      const alias = { x_user_id: targetXId, alias_x_id: xid };
      statements.push(db.insert(xUserAliases).values(alias));
      expected.push(1);
      audits.push({ table_name: "x_user_aliases", target_id: `${targetXId}:${xid}`, operation: "CREATE", before: null, after: alias, actor_user_id: adminId, retention_class: "long_audit" });
    }
    statements.push(db.update(xAccountLinkRequests).set({ status: "approved" }).where(expectedRowCondition({ expectedCurrent: reqRow })));
    expected.push(1);
    if (notification) { statements.push(notification); expected.push(1); }
    audits.push({ table_name: "x_account_link_requests", target_id: requestId, operation: "UPDATE", before: { ...reqRow }, after: { ...afterRequest }, actor_user_id: adminId, retention_class: "long_audit" });
    await mutateWithAudit(db, { mutationStatements: statements, expectedMutationChanges: expected, audits });

    revalidatePath("/dashboard/settings");
    revalidatePath("/admin/x-link-requests");
    revalidatePath("/manage/x-link-requests");
    return { ok: true, message: "alias として承認しました。" };
  }

  // ============================
  // link_type === "merge": 自動マージは危険操作のため拒否。手動対応を促す。
  // 旧データ吸収 / 投稿者付け替え / アイコン継承は監査ログ確認後に手動で行う。
  // ============================
  if (linkType === "merge") {
    return {
      ok: false,
      message:
        "merge 申請は自動承認の対象外です。/admin/audit に履歴を残してから手動で対応してください。",
    };
  }

  // ============================
  // link_type === "new": 既存実装どおり (x_users 行作成 or 既存行へ linked_user_id 更新)
  // ============================
  const existing = (
    await db.select().from(xUsers).where(xUserIdMatches(xid)).limit(1)
  )[0];
  if (
    existing?.linked_user_id &&
    existing.linked_user_id !== userId
  ) {
    return {
      ok: false,
      message: "この X ID は別ユーザーに紐づいているため承認できません。",
    };
  }

  const statements: BatchItem<"sqlite">[] = [];
  const expected: Array<number | null> = [];
  const audits: WriteAuditLogInput[] = [];
  const afterXUser = existing ? {
    ...existing, linked_user_id: userId, approval_status: "approved" as const, approval_requested_at: now,
  } : {
      id: xid,
      x_name: `@${xid}`,
      icon_url: null, profile_text: null, portfolio_contact: null, youtube_channel_url: null,
      other_social_links: null, creative_start_date: null,
      linked_user_id: userId,
      verification_token: null, token_expires_at: null,
      approval_status: "approved" as const,
      approval_requested_at: now,
  };
  if (!existing) {
    statements.push(db.insert(xUsers).values(afterXUser));
  } else {
    statements.push(db.update(xUsers).set({ linked_user_id: userId, approval_status: "approved", approval_requested_at: now }).where(expectedRowCondition({ expectedCurrent: existing })));
  }
  expected.push(1);
  audits.push({ table_name: "x_users", target_id: xid, operation: existing ? "UPDATE" : "CREATE", before: existing ? { ...existing } : null, after: { ...afterXUser }, actor_user_id: adminId, retention_class: "long_audit" });
  const afterRequest = { ...reqRow, status: "approved" as const };
  statements.push(db.update(xAccountLinkRequests).set({ status: "approved" }).where(expectedRowCondition({ expectedCurrent: reqRow })));
  expected.push(1);
  audits.push({ table_name: "x_account_link_requests", target_id: requestId, operation: "UPDATE", before: { ...reqRow }, after: { ...afterRequest }, actor_user_id: adminId, retention_class: "long_audit" });

  const userRow = (
    await db.select().from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (userRow && !userRow.active_x_user_id) {
    const afterUser = { ...userRow, active_x_user_id: xid };
    statements.push(db.update(users).set({ active_x_user_id: xid }).where(expectedRowCondition({ expectedCurrent: userRow })));
    expected.push(1);
    audits.push({ table_name: "user", target_id: userId, operation: "UPDATE", before: { ...userRow }, after: { ...afterUser }, actor_user_id: adminId, retention_class: "long_audit" });
  }
  const notification = await buildNotificationOutboxStatement(db, {
    recipientUserId: userId,
    type: "x_id_approved",
    payload: {
      content: `X ID @${xid} の連携申請が承認されました。`,
      x_user_id: xid,
      request_id: requestId,
    },
  });
  if (notification) { statements.push(notification); expected.push(1); }
  await mutateWithAudit(db, { mutationStatements: statements, expectedMutationChanges: expected, audits });

  revalidatePath("/dashboard/settings");
  revalidatePath("/admin/x-link-requests");
  revalidatePath("/manage/x-link-requests");
  revalidatePath("/dashboard");
  return { ok: true, message: "承認しました。" };
}

/**
 * X ID 連携申請を却下する。
 */
export async function rejectXIdLinkRequest(
  formData: FormData,
): Promise<XIdAdminResult> {
  const operator = await getXIdLinkOperator();
  const adminId = operator?.userId ?? null;
  if (!adminId) return { ok: false, message: "X ID 連携申請を処理する権限がありません。" };

  const requestId = String(formData.get("request_id") ?? "").trim();
  if (!requestId) return { ok: false, message: "申請 ID がありません。" };
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const reqRow = (
    await db
      .select()
      .from(xAccountLinkRequests)
      .where(eq(xAccountLinkRequests.id, requestId))
      .limit(1)
  )[0];
  if (!reqRow) return { ok: false, message: "申請が見つかりません。" };
  if (reqRow.status !== "pending") {
    return { ok: false, message: "すでに処理済みの申請です。" };
  }

  const notification = await buildNotificationOutboxStatement(db, {
    recipientUserId: reqRow.user_id,
    type: "x_id_rejected",
    payload: {
      content: reason
        ? `X ID @${reqRow.requested_x_id} の連携申請が却下されました。理由: ${reason}`
        : `X ID @${reqRow.requested_x_id} の連携申請が却下されました。`,
      requested_x_id: reqRow.requested_x_id,
      request_id: requestId,
      reason: reason || null,
    },
  });
  const afterRequest = { ...reqRow, status: "rejected" as const };
  const statements: BatchItem<"sqlite">[] = [db.update(xAccountLinkRequests).set({ status: "rejected" }).where(expectedRowCondition({ expectedCurrent: reqRow }))];
  const expected = [1];
  if (notification) { statements.push(notification); expected.push(1); }
  await mutateWithAudit(db, {
    mutationStatements: statements,
    expectedMutationChanges: expected,
    audits: [{ table_name: "x_account_link_requests", target_id: requestId, operation: "UPDATE", before: { ...reqRow }, after: { ...afterRequest }, actor_user_id: adminId, reason: reason || null, retention_class: "long_audit" }],
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/admin/x-link-requests");
  revalidatePath("/manage/x-link-requests");
  return { ok: true, message: "却下しました。" };
}
