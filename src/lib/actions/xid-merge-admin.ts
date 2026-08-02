"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import type { DB } from "@/lib/db/client";
import { xIdentityRequests, xUsers } from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import { buildXIdentityDecisionFields } from "@/lib/auth/xIdentityRequestCore";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";
import { isRevertDeadlineOpen, validateXIdentityRequestShape } from "@/lib/auth/xIdentityRequestCore";
import {
  executeApprovedXIdMergeRequest,
  restoreApprovedXIdMergeRevertRequest,
} from "@/lib/xid/merge";

export interface XIdMergeAdminResult {
  ok: boolean;
  message?: string;
  id?: string;
}

async function requireAdmin(): Promise<
  | { ok: true; authUserId: string; db: DB; actorXUserId: string | null }
  | { ok: false; result: XIdMergeAdminResult }
> {
  const guard = await requireAdminWrite("xid_links");
  if (!guard.ok) {
    return { ok: false, result: { ok: false, message: guard.message } };
  }
  return {
    ok: true,
    authUserId: guard.user.id,
    db: guard.db,
    actorXUserId: normalizeXId(guard.activeXId ?? "") || null,
  };
}

function revalidateMergePaths(sourceXUserId?: string | null, targetXUserId?: string | null): void {
  revalidatePath("/admin/x-id-merges");
  revalidatePath("/admin/x-link-requests");
  revalidatePath("/admin/users");
  revalidatePath("/manage/x-link-requests");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  if (sourceXUserId) revalidatePath(`/user/${sourceXUserId}`);
  if (targetXUserId) revalidatePath(`/user/${targetXUserId}`);
}

async function runXIdMergePostCommit(
  flow: string,
  run: () => void | Promise<void>,
): Promise<void> {
  await runPostCommitBestEffort(
    { flow, traceId: createTraceId() },
    [{ name: "revalidate", run: async () => { await run(); } }],
  );
}

function mutationError(): XIdMergeAdminResult {
  return {
    ok: false,
    message: "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。",
  };
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
  try {
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
          actor_x_user_id: guard.actorXUserId,
          reason: "管理者がX ID統合申請を作成",
          context: "x-id-merge:request",
          retention_class: "long_audit",
        },
      ],
    });
  } catch (error) {
    unstable_rethrow(error);
    return mutationError();
  }
  await runXIdMergePostCommit("xid-merge-admin.createXIdMergeRequest", () => {
    revalidateMergePaths(sourceXUserId, targetXUserId);
  });
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
  const decisionFields = buildXIdentityDecisionFields({
    decidedByAuthUserId: guard.authUserId,
    decisionReason:
      status === "approved" ? "X ID統合申請を承認" : "X ID統合申請を却下",
    decidedAt: now,
  });
  const after = { ...current, status, updated_at: now, ...decisionFields };
  try {
    await mutateWithAudit(guard.db, {
      mutationStatements: [
        guard.db
          .update(xIdentityRequests)
          .set({
            status,
            updated_at: now,
            ...decisionFields,
          })
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
          actor_x_user_id: guard.actorXUserId,
          reason: status === "approved" ? "X ID申請を承認" : "X ID申請を却下",
          context: "x-id-merge:request",
          retention_class: "long_audit",
        },
      ],
    });
  } catch (error) {
    unstable_rethrow(error);
    return mutationError();
  }
  await runXIdMergePostCommit("xid-merge-admin.setRequestStatus", () => {
    revalidateMergePaths(current.source_x_user_id, current.target_x_user_id);
  });
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
  const shapeError = validateXIdentityRequestShape({
    requestType: "merge",
    sourceXUserId: request.source_x_user_id,
    targetXUserId: request.target_x_user_id,
  });
  if (shapeError) return { ok: false, message: shapeError };

  try {
    const result = await executeApprovedXIdMergeRequest(guard.db, {
      request,
      actorAuthUserId: guard.authUserId,
    });
    await runXIdMergePostCommit("xid-merge-admin.executeXIdMergeRequest", () => {
      revalidateMergePaths(request.source_x_user_id, request.target_x_user_id);
    });
    return {
      ok: true,
      id,
      message: `@${request.source_x_user_id} → @${request.target_x_user_id} に統合しました（${Object.values(result.counts).reduce((sum, value) => sum + value, 0)}件更新）。`,
    };
  } catch (cause) {
    unstable_rethrow(cause);
    return {
      ok: false,
      id,
      message: cause instanceof Error ? cause.message : "X ID統合を安全に確定できませんでした。",
    };
  }
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
  const parentRequest = (
    await guard.db
      .select()
      .from(xIdentityRequests)
      .where(eq(xIdentityRequests.id, request.parent_request_id!))
      .limit(1)
  )[0];
  if (!parentRequest) return { ok: false, message: "親統合申請が見つかりません。" };

  try {
    const counts = await restoreApprovedXIdMergeRevertRequest(guard.db, {
      request,
      parentRequest,
      actorAuthUserId: guard.authUserId,
    });
    await runXIdMergePostCommit("xid-merge-admin.approveXIdMergeRevert", () => {
      revalidateMergePaths(parentRequest.source_x_user_id, parentRequest.target_x_user_id);
    });
    return {
      ok: true,
      id,
      message: `X ID統合を差し戻しました（${Object.values(counts).reduce((sum, value) => sum + value, 0)}件復元）。`,
    };
  } catch (cause) {
    unstable_rethrow(cause);
    return {
      ok: false,
      id,
      message: cause instanceof Error ? cause.message : "X ID統合を安全に差し戻せませんでした。",
    };
  }
}
