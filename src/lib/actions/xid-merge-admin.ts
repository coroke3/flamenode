"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import {
  xIdMergeRequests,
  xIdMergeReverts,
  xUsers,
} from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import { fetchXIdMergeImpact, summarizeMergeImpact } from "@/lib/admin/xIdMergeImpact";
import { mergeXIds } from "@/lib/actions/merge-admin";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";

export interface XIdMergeAdminResult {
  ok: boolean;
  message?: string;
  id?: string;
}

async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; result: XIdMergeAdminResult }
> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) return { ok: false, result: { ok: false, message: "ログインが必要です。" } };
  if (u.role !== "admin") {
    return { ok: false, result: { ok: false, message: "管理者のみ操作できます。" } };
  }
  return { ok: true, userId: u.id };
}

export async function createXIdMergeRequest(
  formData: FormData,
): Promise<XIdMergeAdminResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const fromXId = normalizeXId(String(formData.get("from_x_user_id") ?? ""));
  const toXId = normalizeXId(String(formData.get("to_x_user_id") ?? ""));
  if (!fromXId || !toXId) return { ok: false, message: "from / to が必要です。" };
  if (fromXId === toXId) return { ok: false, message: "from と to が同じです。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const fromRow = await db.select({ id: xUsers.id }).from(xUsers).where(eq(xUsers.id, fromXId)).limit(1);
  const toRow = await db.select({ id: xUsers.id }).from(xUsers).where(eq(xUsers.id, toXId)).limit(1);
  if (!fromRow[0]) return { ok: false, message: `from @${fromXId} が見つかりません。` };
  if (!toRow[0]) return { ok: false, message: `to @${toXId} が見つかりません。` };

  const now = Math.floor(Date.now() / 1000);
  const id = generateId("xmerge");
  const after = {
    id,
    from_x_user_id: fromXId,
    to_x_user_id: toXId,
    requested_by_user_id: guard.userId,
    status: "pending" as const,
    created_at: now,
    updated_at: now,
  };
  await mutateWithAudit(db, {
    mutationStatements: [db.insert(xIdMergeRequests).values(after)],
    expectedMutationChanges: [1],
    audits: [{ table_name: "x_id_merge_requests", target_id: id, operation: "CREATE", before: null, after: { ...after }, actor_user_id: guard.userId, retention_class: "long_audit" }],
  });
  revalidatePath("/admin/x-id-merges");
  return { ok: true, id, message: "X ID 統合申請を作成しました。" };
}

export async function approveXIdMergeRequest(
  formData: FormData,
): Promise<XIdMergeAdminResult> {
  return setXIdMergeRequestStatus(formData, "approved");
}

export async function rejectXIdMergeRequest(
  formData: FormData,
): Promise<XIdMergeAdminResult> {
  return setXIdMergeRequestStatus(formData, "rejected");
}

async function setXIdMergeRequestStatus(
  formData: FormData,
  status: "approved" | "rejected",
): Promise<XIdMergeAdminResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, message: "id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const current = (
    await db.select().from(xIdMergeRequests).where(eq(xIdMergeRequests.id, id)).limit(1)
  )[0];
  if (!current) return { ok: false, message: "申請が見つかりません。" };
  if (current.status !== "pending") {
    return { ok: false, message: `status=${current.status} は変更できません。` };
  }
  const now = Math.floor(Date.now() / 1000);
  const after = { ...current, status, updated_at: now };
  await mutateWithAudit(db, {
    mutationStatements: [db.update(xIdMergeRequests).set({ status, updated_at: now }).where(expectedRowCondition({ expectedCurrent: current }))],
    expectedMutationChanges: [1],
    audits: [{ table_name: "x_id_merge_requests", target_id: id, operation: "UPDATE", before: { ...current }, after: { ...after }, actor_user_id: guard.userId, retention_class: "long_audit" }],
  });
  revalidatePath("/admin/x-id-merges");
  return { ok: true, id, message: status === "approved" ? "承認しました。" : "却下しました。" };
}

export async function executeXIdMergeRequest(
  formData: FormData,
): Promise<XIdMergeAdminResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const id = String(formData.get("id") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!id) return { ok: false, message: "id が必要です。" };
  if (confirm !== "MERGE") return { ok: false, message: "確認文字列 MERGE が必要です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const request = (
    await db.select().from(xIdMergeRequests).where(eq(xIdMergeRequests.id, id)).limit(1)
  )[0];
  if (!request) return { ok: false, message: "申請が見つかりません。" };
  if (request.status !== "approved") {
    return { ok: false, message: "先に承認してください。" };
  }

  const impact = await fetchXIdMergeImpact(db, request.from_x_user_id);
  const snapshot = {
    request_id: id,
    from_x_user_id: request.from_x_user_id,
    to_x_user_id: request.to_x_user_id,
    impact,
    summary: summarizeMergeImpact(impact),
    captured_at: Math.floor(Date.now() / 1000),
  };

  const fd = new FormData();
  fd.set("from", request.from_x_user_id);
  fd.set("to", request.to_x_user_id);
  fd.set("confirm", "MERGE");
  const merged = await mergeXIds(fd);
  if (!merged.ok) return { ok: false, message: merged.message ?? "統合に失敗しました。" };

  const now = Math.floor(Date.now() / 1000);
  const after = { ...request, status: "done" as const, updated_at: now };
  await mutateWithAudit(db, {
    mutationStatements: [db.update(xIdMergeRequests).set({ status: "done", updated_at: now }).where(expectedRowCondition({ expectedCurrent: request }))],
    expectedMutationChanges: [1],
    audits: [
      { table_name: "x_id_merge_requests", target_id: id, operation: "UPDATE", before: { ...request }, after: { ...after }, actor_user_id: guard.userId, retention_class: "long_audit" },
      { table_name: "x_id_merge_requests", target_id: `${id}:restore_snapshot`, operation: "SYSTEM", before: null, after: { restore_snapshot: snapshot }, actor_user_id: guard.userId, reason: "x_id_merge_restore_snapshot", retention_class: "long_audit", restore_strategy: "none" },
    ],
  });
  revalidatePath("/admin/x-id-merges");
  return { ok: true, id, message: merged.message };
}

export async function rejectXIdMergeRevert(
  formData: FormData,
): Promise<XIdMergeAdminResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, message: "id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const current = (
    await db.select().from(xIdMergeReverts).where(eq(xIdMergeReverts.id, id)).limit(1)
  )[0];
  if (!current) return { ok: false, message: "取り消し申請が見つかりません。" };
  if (current.status !== "pending") {
    return { ok: false, message: `status=${current.status} は変更できません。` };
  }
  const now = Math.floor(Date.now() / 1000);
  const after = { ...current, status: "rejected" as const, updated_at: now };
  await mutateWithAudit(db, {
    mutationStatements: [db.update(xIdMergeReverts).set({ status: "rejected", updated_at: now }).where(expectedRowCondition({ expectedCurrent: current }))],
    expectedMutationChanges: [1],
    audits: [{ table_name: "x_id_merge_reverts", target_id: id, operation: "UPDATE", before: { ...current }, after: { ...after }, actor_user_id: guard.userId, retention_class: "long_audit" }],
  });
  revalidatePath("/admin/x-id-merges");
  return { ok: true, message: "取り消し申請を却下しました。" };
}
