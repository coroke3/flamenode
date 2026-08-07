"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { canManageXIdLinkRequests } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import type { DB } from "@/lib/db/client";
import {
  slots,
  users,
  xIdentityRequests,
  xUserAccountLinks,
  xUserAliases,
  xUsers,
} from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import type { BatchItem } from "drizzle-orm/batch";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import {
  isAuthUserLinkedToXUser,
  resolveCanonicalXUserId,
} from "@/lib/auth/xIdentity";
import { validateXIdentityRequestShape, buildXIdentityDecisionFields } from "@/lib/auth/xIdentityRequestCore";
import {
  buildStaticRebuildQueueBatch,
  STATIC_REBUILD_BULK_UPSERT_ROWS,
} from "@/lib/staticRebuild/enqueue";
import { MAX_ATOMIC_SLOT_ROWS } from "@/lib/slots/atomicLimits";
import { versionedSlotWhere } from "@/lib/slots/versionedPredicate";
import {
  D1_MAX_BATCH_QUERIES,
  planD1AuditMutationBudget,
} from "@/lib/audit/mutateBudget";
import {
  isRetryableXIdMutationError,
  processedXIdRequestMessage,
} from "@/lib/actions/xidRequestReliabilityCore";

export interface XIdAdminResult {
  ok: boolean;
  message?: string;
}

type XIdLinkOperatorResult =
  | { ok: true; authUserId: string; db: DB; actorXUserId: string | null }
  | { ok: false; message: string };
type XIdLinkOperator = Extract<XIdLinkOperatorResult, { ok: true }>;
type SlotRow = typeof slots.$inferSelect;

/** 承認時に一括で x_user_id を埋める reserved 枠の上限（D1 batch 予算保護）。 */
const RESERVED_SLOT_BIND_CAP = 30;

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
      ? {
          ok: true,
          authUserId: user.id,
          db,
          actorXUserId: normalizeXId(guard.activeXId ?? "") || null,
        }
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

async function runXIdAdminPostCommit(
  flow: string,
  run: () => void | Promise<void>,
): Promise<void> {
  await runPostCommitBestEffort(
    { flow, traceId: createTraceId() },
    [{ name: "revalidate", run: async () => { await run(); } }],
  );
}

function mutationError(error: unknown): XIdAdminResult {
  console.error("[xid-admin] mutation failed", error);
  return {
    ok: false,
    message: "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。",
  };
}

function snapshotSlot(row: SlotRow): Record<string, unknown> {
  return { ...row };
}

function applySlotXUserBind(
  before: SlotRow,
  bindTargetXUserId: string,
  now: number,
): SlotRow {
  return {
    ...before,
    x_user_id: bindTargetXUserId,
    updated_at: now,
    version: before.version + 1,
  };
}

function groupSlotBindChunks(rows: readonly SlotRow[]): SlotRow[][] {
  const byEvent = new Map<string, SlotRow[]>();
  for (const row of rows) {
    const current = byEvent.get(row.event_id) ?? [];
    current.push(row);
    byEvent.set(row.event_id, current);
  }
  const chunks: SlotRow[][] = [];
  for (const eventRows of byEvent.values()) {
    for (let index = 0; index < eventRows.length; index += MAX_ATOMIC_SLOT_ROWS) {
      chunks.push(eventRows.slice(index, index + MAX_ATOMIC_SLOT_ROWS));
    }
  }
  return chunks;
}

function planSlotBindBatchBudget(chunks: readonly SlotRow[][]): {
  chunks: SlotRow[][];
  deferred: number;
} {
  const accepted: SlotRow[][] = [];
  for (const chunk of chunks) {
    const slotCount = accepted.reduce((sum, rows) => sum + rows.length, 0) + chunk.length;
    const eventIds = new Set(
      [...accepted, chunk].flatMap((rows) => rows.map((row) => row.event_id)),
    );
    const budget = planD1AuditMutationBudget({
      mutationStatementCount: accepted.length + 1,
      mutationAssertionCount: accepted.length + 1,
      auditEntryCount: slotCount,
      postAuditStatementCount: Math.ceil(
        eventIds.size / STATIC_REBUILD_BULK_UPSERT_ROWS,
      ),
      distinctActorCount: 1,
    });
    if (!budget.withinLimit || budget.totalQueryCount > D1_MAX_BATCH_QUERIES) {
      break;
    }
    accepted.push(chunk);
  }
  const bound = accepted.reduce((sum, rows) => sum + rows.length, 0);
  return {
    chunks: accepted,
    deferred: chunks.reduce((sum, rows) => sum + rows.length, 0) - bound,
  };
}

async function bindReservedSlotsOnXApproval(args: {
  db: DB;
  requestedAuthUserId: string;
  submittedXUserId: string;
  bindTargetXUserId: string;
  operatorAuthUserId: string;
  operatorActorXUserId: string | null;
}): Promise<string[]> {
  const candidateRows = await args.db
    .select()
    .from(slots)
    .where(
      and(
        eq(slots.reserved_by_user_id, args.requestedAuthUserId),
        eq(slots.status, "reserved"),
        isNull(slots.x_user_id),
        or(
          isNull(slots.reserved_x_id_snapshot),
          eq(slots.reserved_x_id_snapshot, args.submittedXUserId),
        )!,
      )!,
    )
    .orderBy(
      asc(slots.event_id),
      asc(slots.start_time),
      asc(slots.sort_order),
      asc(slots.id),
    )
    .limit(RESERVED_SLOT_BIND_CAP);

  if (candidateRows.length === 0) return [];

  const allChunks = groupSlotBindChunks(candidateRows);
  const allAffectedEventIds = new Set<string>();
  let remainingChunks = allChunks;

  while (remainingChunks.length > 0) {
    const { chunks, deferred } = planSlotBindBatchBudget(remainingChunks);
    if (chunks.length === 0) {
      if (deferred > 0) {
        console.warn(
          "[xid-admin] reserved slot bind deferred due to D1 batch budget",
          { deferred, cap: RESERVED_SLOT_BIND_CAP },
        );
      }
      break;
    }

    const now = Math.floor(Date.now() / 1000);
    const mutationStatements: BatchItem<"sqlite">[] = [];
    const expectedMutationChanges: Array<number | null> = [];
    const audits: WriteAuditLogInput[] = [];
    const batchEventIds = new Set<string>();

    for (const chunk of chunks) {
      const eventId = chunk[0]!.event_id;
      mutationStatements.push(
        args.db
          .update(slots)
          .set({
            x_user_id: args.bindTargetXUserId,
            updated_at: now,
            version: sql`${slots.version} + 1`,
          })
          .where(versionedSlotWhere(eventId, chunk, "reserved")),
      );
      expectedMutationChanges.push(chunk.length);
      for (const before of chunk) {
        audits.push({
          table_name: "slots",
          target_id: before.id,
          operation: "UPDATE",
          before: snapshotSlot(before),
          after: snapshotSlot(
            applySlotXUserBind(before, args.bindTargetXUserId, now),
          ),
          actor_user_id: args.operatorAuthUserId,
          actor_x_user_id: args.operatorActorXUserId,
          reason: "slot bind on X approve",
          context: "x-identity-request",
          retention_class: "normal",
        });
      }
      batchEventIds.add(eventId);
      allAffectedEventIds.add(eventId);
    }

    const rebuildTargets = [...batchEventIds].map((eventId) => ({
      targetType: "event_slots" as const,
      targetId: eventId,
      reason: "x_id_approved_slot_bind",
      priority: "high" as const,
      requestedByUserId: args.operatorAuthUserId,
    }));
    const queue = await buildStaticRebuildQueueBatch(args.db, rebuildTargets);
    mutationStatements.push(...queue.statements);
    expectedMutationChanges.push(...queue.expectedChanges);

    await mutateWithAudit(args.db, {
      mutationStatements,
      expectedMutationChanges,
      audits,
      staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
    });

    remainingChunks = remainingChunks.slice(chunks.length);
    if (remainingChunks.length > 0 && deferred > 0) {
      console.warn(
        "[xid-admin] reserved slot bind deferred due to D1 batch budget",
        {
          deferred: remainingChunks.reduce((sum, rows) => sum + rows.length, 0),
          cap: RESERVED_SLOT_BIND_CAP,
        },
      );
      break;
    }
  }

  return [...allAffectedEventIds];
}

async function approveXIdLinkRequestOnce(
  operator: XIdLinkOperator,
  requestId: string,
): Promise<XIdAdminResult> {
  const { db, authUserId: operatorAuthUserId, actorXUserId: operatorActorXUserId } = operator;
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
  const decisionFields = buildXIdentityDecisionFields({
    decidedByAuthUserId: operatorAuthUserId,
    decisionReason: "X ID申請を承認",
    decidedAt: now,
  });
  const statements: BatchItem<"sqlite">[] = [];
  const expected: Array<number | null> = [];
  const audits: WriteAuditLogInput[] = [];
  let notificationXUserId: string | null = null;
  let bindTargetXUserId: string | null = null;
  let publicVisibilityChanged = false;

  if (request.request_type === "alias") {
    const targetXUserId = await resolveCanonicalXUserId(db, request.target_x_user_id);
    if (!submittedXUserId || !targetXUserId) {
      return { ok: false, message: "別名申請のX IDまたは追加先が不足しています。" };
    }
    bindTargetXUserId = targetXUserId;
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
        actor_x_user_id: operatorActorXUserId,
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
    bindTargetXUserId = effectiveXUserId;
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
      publicVisibilityChanged = true;
      audits.push({
        table_name: "x_users",
        target_id: effectiveXUserId,
        operation: "CREATE",
        before: null,
        after: newXUser,
        actor_user_id: operatorAuthUserId,
        actor_x_user_id: operatorActorXUserId,
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
      publicVisibilityChanged = true;
      audits.push({
        table_name: "x_users",
        target_id: effectiveXUserId,
        operation: "UPDATE",
        before: { ...xUser },
        after: afterXUser,
        actor_user_id: operatorAuthUserId,
        actor_x_user_id: operatorActorXUserId,
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
        actor_x_user_id: operatorActorXUserId,
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
        actor_x_user_id: operatorActorXUserId,
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
      const afterSibling = {
        ...sibling,
        status: "cancelled" as const,
        updated_at: now,
        ...buildXIdentityDecisionFields({
          decidedByAuthUserId: operatorAuthUserId,
          decisionReason: "同一X IDの重複pending申請を取り消す",
          decidedAt: now,
        }),
      };
      statements.push(
        db
          .update(xIdentityRequests)
          .set({
            status: "cancelled",
            updated_at: now,
            ...buildXIdentityDecisionFields({
              decidedByAuthUserId: operatorAuthUserId,
              decisionReason: "同一X IDの重複pending申請を取り消す",
              decidedAt: now,
            }),
          })
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
        actor_x_user_id: operatorActorXUserId,
        reason: "同一X IDの重複pending申請を取り消す",
        context: "x-identity-request",
        retention_class: "long_audit",
      });
    }
  }

  const afterRequest = {
    ...request,
    status: "approved" as const,
    updated_at: now,
    ...decisionFields,
  };
  statements.push(
    db
      .update(xIdentityRequests)
      .set({
        status: "approved",
        updated_at: now,
        ...decisionFields,
      })
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
    actor_x_user_id: operatorActorXUserId,
    reason: "X ID申請を承認",
    context: "x-identity-request",
    retention_class: "long_audit",
  });

  const {
    buildXIdApprovedNotification,
    buildXIdAliasApprovedNotification,
  } = await import("@/lib/notifications/templates/xid");
  const notification = await buildNotificationOutboxStatement(db, {
    recipientUserId: requestedAuthUserId,
    type: request.request_type === "alias" ? "x_id_alias_approved" : "x_id_approved",
    payload:
      request.request_type === "alias"
        ? buildXIdAliasApprovedNotification({
            xUserId: submittedXUserId,
            requestId: request.id,
          })
        : buildXIdApprovedNotification({
            xUserId: notificationXUserId,
            requestId: request.id,
          }),
    dedupeKey: `xid_approved:${request.id}`,
  });
  if (notification) {
    statements.push(notification.statement);
    expected.push(null);
  }

  if (publicVisibilityChanged && notificationXUserId) {
    const queue = await buildStaticRebuildQueueBatch(db, [
      {
        targetType: "user",
        targetId: notificationXUserId,
        reason: "x_id_approved",
        requestedByUserId: operatorAuthUserId,
        priority: "normal",
      },
      {
        targetType: "users_index",
        targetId: "global",
        reason: "x_id_approved",
        requestedByUserId: operatorAuthUserId,
        priority: "low",
      },
    ]);
    statements.push(...queue.statements);
    expected.push(...queue.expectedChanges);
  }

  await mutateWithAudit(db, {
    mutationStatements: statements,
    expectedMutationChanges: expected,
    audits,
    notificationWakeSource: notification ? "admin" : undefined,
    staticRebuildWakeSource:
      publicVisibilityChanged && notificationXUserId ? "admin" : undefined,
  });

  let slotBindEventIds: string[] = [];
  if (bindTargetXUserId && submittedXUserId) {
    slotBindEventIds = await bindReservedSlotsOnXApproval({
      db,
      requestedAuthUserId,
      submittedXUserId,
      bindTargetXUserId,
      operatorAuthUserId,
      operatorActorXUserId,
    });
  }

  await runXIdAdminPostCommit("xid-admin.approveXIdLinkRequest", () => {
    revalidateIdentityAdminPaths();
    for (const eventId of slotBindEventIds) {
      revalidatePath(`/event/${eventId}/slots`);
    }
  });
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
      unstable_rethrow(error);
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
          if (result.ok) {
            await runXIdAdminPostCommit("xid-admin.approveXIdLinkRequest", () => {
              revalidateIdentityAdminPaths();
            });
          }
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
  const { db, authUserId: operatorAuthUserId, actorXUserId: operatorActorXUserId } = operator;
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
  const decisionFields = buildXIdentityDecisionFields({
    decidedByAuthUserId: operatorAuthUserId,
    decisionReason: reason || "X ID申請を却下",
    decidedAt: now,
  });
  const afterRequest = {
    ...request,
    status: "rejected" as const,
    updated_at: now,
    ...decisionFields,
  };
  const rejectedXIdLabel =
    request.requested_x_id ?? request.source_x_user_id ?? "不明";
  const { buildXIdRejectedNotification } = await import(
    "@/lib/notifications/templates/xid"
  );
  const notification = await buildNotificationOutboxStatement(db, {
    recipientUserId: request.requested_by_auth_user_id,
    type: "x_id_rejected",
    payload: buildXIdRejectedNotification({
      requestedXId: request.requested_x_id ?? rejectedXIdLabel,
      requestId: request.id,
      reason: reason || null,
    }),
    dedupeKey: `xid_rejected:${request.id}`,
  });
  const { buildChannelXIdRejectedNotification } = await import(
    "@/lib/notifications/templates/xidChannel"
  );
  const { buildOpsChannelWebhookStatement } = await import(
    "@/lib/notifications/opsWebhook"
  );
  const requester = (
    await db
      .select({ discord_id: users.discord_id })
      .from(users)
      .where(eq(users.id, request.requested_by_auth_user_id))
      .limit(1)
  )[0];
  const channelNotification = await buildOpsChannelWebhookStatement(db, {
    actorUserId: operatorAuthUserId,
    payload: buildChannelXIdRejectedNotification({
      requestId: request.id,
      requestType: request.request_type,
      requestedXId: request.requested_x_id,
      sourceXUserId: request.source_x_user_id,
      targetXUserId: request.target_x_user_id,
      requesterUserId: request.requested_by_auth_user_id,
      requesterDiscordId: requester?.discord_id ?? null,
      operatorUserId: operatorAuthUserId,
      reason: reason || null,
      rejectedAt: now,
    }),
    dedupeKey: `xid_reject_webhook:${request.id}`,
  });
  const statements: BatchItem<"sqlite">[] = [
    db
      .update(xIdentityRequests)
      .set({
        status: "rejected",
        updated_at: now,
        ...decisionFields,
      })
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
  if (channelNotification) {
    statements.push(channelNotification.statement);
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
        actor_x_user_id: operatorActorXUserId,
        reason: reason || "X ID申請を却下",
        context: "x-identity-request",
        retention_class: "long_audit",
      },
    ],
    notificationWakeSource:
      notification || channelNotification ? "admin" : undefined,
  });
  await runXIdAdminPostCommit("xid-admin.rejectXIdLinkRequest", () => {
    revalidateIdentityAdminPaths();
  });
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
      unstable_rethrow(error);
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
          if (result.ok) {
            await runXIdAdminPostCommit("xid-admin.rejectXIdLinkRequest", () => {
              revalidateIdentityAdminPaths();
            });
          }
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
