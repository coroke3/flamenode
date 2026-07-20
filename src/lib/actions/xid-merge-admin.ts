"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { xIdentityRequests, xUsers } from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import { mergeXIds } from "@/lib/actions/merge-admin";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";
import { isRevertDeadlineOpen, validateXIdentityRequestShape } from "@/lib/auth/xIdentityRequestCore";
import { restoreXIdMerge } from "@/lib/xid/merge";

export interface XIdMergeAdminResult {
  ok: boolean;
  message?: string;
  id?: string;
}

type DB = NonNullable<ReturnType<typeof getDatabase>>;

async function requireAdmin(): Promise<
  | { ok: true; authUserId: string; db: DB }
  | { ok: false; result: XIdMergeAdminResult }
> {
  const session = await auth().catch(() => null);
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id) return { ok: false, result: { ok: false, message: "ログインが必要です。" } };
  if (user.role !== "admin") {
    return { ok: false, result: { ok: false, message: "管理者のみ操作できます。" } };
  }
  const db = getDatabase();
  if (!db) return { ok: false, result: { ok: false, message: "DB に接続できません。" } };
  return { ok: true, authUserId: user.id, db };
}

function revalidateMergePaths(): void {
  revalidatePath("/admin/x-id-merges");
  revalidatePath("/admin/x-link-requests");
  revalidatePath("/manage/x-link-requests");
  revalidatePath("/dashboard/settings");
}

export async function createXIdMergeRequest(formData: FormData): Promise<XIdMergeAdminResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const sourceXUserId = normalizeXId(String(formData.get("from_x_user_id") ?? ""));
  const targetXUserId = normalizeXId(String(formData.get("to_x_user_id") ?? ""));
  const shapeError = validateXIdentityRequestShape({
    requestType: "merge",
    sourceXUserId,
    targetXUserId,
  });
  if (shapeError) return { ok: false, message: shapeError };

  const [source, target] = await Promise.all([
    guard.db.select({ id: xUsers.id }).from(xUsers).where(eq(xUsers.id, sourceXUserId)).limit(1),
    guard.db.select({ id: xUsers.id }).from(xUsers).where(eq(xUsers.id, targetXUserId)).limit(1),
  ]);
  if (!source[0]) return { ok: false, message: `統合元 @${sourceXUserId} が見つかりません。` };
  if (!target[0]) return { ok: false, message: `統合先 @${targetXUserId} が見つかりません。` };

  const now = Math.floor(Date.now() / 1000);
  const id = generateId("xmerge");
  const row = {
    id,
    request_type: "merge" as const,
    requested_by_auth_user_id: guard.authUserId,
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
  await mutateWithAudit(guard.db, {
    mutationStatements: [guard.db.insert(xIdentityRequests).values(row)],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "x_identity_requests",
        target_id: id,
        operation: "CREATE",
        before: null,
        after: row,
        actor_user_id: guard.authUserId,
        retention_class: "long_audit",
      },
    ],
  });
  revalidateMergePaths();
  return { ok: true, id, message: "X ID 統合申請を作成しました。" };
}

export async function approveXIdMergeRequest(formData: FormData): Promise<XIdMergeAdminResult> {
  return setRequestStatus(formData, "merge", "approved");
}

export async function rejectXIdMergeRequest(formData: FormData): Promise<XIdMergeAdminResult> {
  return setRequestStatus(formData, "merge", "rejected");
}

export async function rejectXIdMergeRevert(formData: FormData): Promise<XIdMergeAdminResult> {
  return setRequestStatus(formData, "revert_merge", "rejected");
}

async function setRequestStatus(
  formData: FormData,
  requestType: "merge" | "revert_merge",
  status: "approved" | "rejected",
): Promise<XIdMergeAdminResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const id = String(formData.get("id") ?? formData.get("request_id") ?? "").trim();
  if (!id) return { ok: false, message: "申請 ID が必要です。" };
  const current = (
    await guard.db.select().from(xIdentityRequests).where(eq(xIdentityRequests.id, id)).limit(1)
  )[0];
  if (!current || current.request_type !== requestType) {
    return { ok: false, message: "対象の申請が見つかりません。" };
  }
  if (current.status !== "pending") {
    return { ok: false, message: `status=${current.status} は変更できません。` };
  }
  const now = Math.floor(Date.now() / 1000);
  const after = { ...current, status, updated_at: now };
  await mutateWithAudit(guard.db, {
    mutationStatements: [
      guard.db
        .update(xIdentityRequests)
        .set({ status, updated_at: now })
        .where(expectedRowCondition({ expectedCurrent: current })),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "x_identity_requests",
        target_id: id,
        operation: "UPDATE",
        before: current,
        after,
        actor_user_id: guard.authUserId,
        retention_class: "long_audit",
      },
    ],
  });
  revalidateMergePaths();
  return { ok: true, id, message: status === "approved" ? "承認しました。" : "却下しました。" };
}

export async function executeXIdMergeRequest(formData: FormData): Promise<XIdMergeAdminResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const id = String(formData.get("id") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!id) return { ok: false, message: "申請 ID が必要です。" };
  if (confirm !== "MERGE") return { ok: false, message: "確認文字列 MERGE が必要です。" };

  const request = (
    await guard.db.select().from(xIdentityRequests).where(eq(xIdentityRequests.id, id)).limit(1)
  )[0];
  if (!request || request.request_type !== "merge") {
    return { ok: false, message: "統合申請が見つかりません。" };
  }
  if (request.status !== "approved") return { ok: false, message: "先に承認してください。" };
  const shapeError = validateXIdentityRequestShape({
    requestType: "merge",
    sourceXUserId: request.source_x_user_id,
    targetXUserId: request.target_x_user_id,
  });
  if (shapeError) return { ok: false, message: shapeError };

  const mergeForm = new FormData();
  mergeForm.set("from", request.source_x_user_id!);
  mergeForm.set("to", request.target_x_user_id!);
  mergeForm.set("confirm", "MERGE");
  const merged = await mergeXIds(mergeForm);
  if (!merged.ok || !merged.restoreSnapshotJson || !merged.revertDeadlineAt) {
    return { ok: false, message: merged.message ?? "統合に失敗しました。" };
  }

  const now = Math.floor(Date.now() / 1000);
  const after = {
    ...request,
    status: "done" as const,
    restore_snapshot_json: merged.restoreSnapshotJson,
    revert_deadline_at: merged.revertDeadlineAt,
    updated_at: now,
  };
  await mutateWithAudit(guard.db, {
    mutationStatements: [
      guard.db
        .update(xIdentityRequests)
        .set({
          status: "done",
          restore_snapshot_json: merged.restoreSnapshotJson,
          revert_deadline_at: merged.revertDeadlineAt,
          updated_at: now,
        })
        .where(expectedRowCondition({ expectedCurrent: request })),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "x_identity_requests",
        target_id: id,
        operation: "UPDATE",
        before: request,
        after,
        actor_user_id: guard.authUserId,
        reason: "X ID統合を実行し復元情報と期限を保存",
        retention_class: "long_audit",
        restore_strategy: "none",
      },
    ],
  });
  revalidateMergePaths();
  return { ok: true, id, message: merged.message };
}

export async function approveXIdMergeRevert(formData: FormData): Promise<XIdMergeAdminResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const id = String(formData.get("id") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!id) return { ok: false, message: "申請 ID が必要です。" };
  if (confirm !== "REVERT") return { ok: false, message: "確認文字列 REVERT が必要です。" };

  const request = (
    await guard.db.select().from(xIdentityRequests).where(eq(xIdentityRequests.id, id)).limit(1)
  )[0];
  if (!request || request.request_type !== "revert_merge") {
    return { ok: false, message: "差し戻し申請が見つかりません。" };
  }
  if (request.status !== "pending" && request.status !== "approved") {
    return { ok: false, message: "この差し戻し申請は処理できません。" };
  }
  const now = Math.floor(Date.now() / 1000);
  const shapeError = validateXIdentityRequestShape({
    requestType: "revert_merge",
    parentRequestId: request.parent_request_id,
    restoreSnapshotJson: request.restore_snapshot_json,
    revertDeadlineAt: request.revert_deadline_at,
  });
  if (shapeError) return { ok: false, message: shapeError };
  if (!isRevertDeadlineOpen(request.revert_deadline_at, now)) {
    return { ok: false, message: "統合の差し戻し期限を過ぎています。" };
  }

  const counts = await restoreXIdMerge(guard.db, {
    restoreSnapshotJson: request.restore_snapshot_json!,
    actorAuthUserId: guard.authUserId,
  });
  const after = { ...request, status: "done" as const, updated_at: now };
  await mutateWithAudit(guard.db, {
    mutationStatements: [
      guard.db
        .update(xIdentityRequests)
        .set({ status: "done", updated_at: now })
        .where(expectedRowCondition({ expectedCurrent: request })),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "x_identity_requests",
        target_id: request.id,
        operation: "UPDATE",
        before: request,
        after: { ...after, restored_counts: counts },
        actor_user_id: guard.authUserId,
        reason: "X ID統合を期限内に差し戻し",
        retention_class: "long_audit",
        restore_strategy: "none",
      },
    ],
  });
  revalidateMergePaths();
  return { ok: true, id, message: "X ID統合を差し戻しました。" };
}
