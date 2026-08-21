"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
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
  getLinkedXUserIdsForAuthUser,
  resolveCanonicalXUserId,
} from "@/lib/auth/xIdentity";
import { isApprovedLinkedXUser } from "@/lib/auth/approvedX";
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
import { canAutoBindUnassignedReservation } from "@/lib/slots/reservationBindIdentityCore";

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
/** 1回のWeb Action/retryで読むbind page数。残件はpendingのままrecoveryへ渡す。 */
const MAX_SLOT_BIND_PAGES_PER_REQUEST = 2;
const SLOT_BIND_REQUEST_TYPES = ["new_link", "existing_link", "alias"] as const;
/** D1のbind parameter上限に余裕を残したcandidate lookupの分割幅。 */
const RESERVATION_BIND_CANONICALIZE_CHUNK = 80;

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
    // queue statements are appended to mutationStatements below and each has
    // its own expected changes assertion. Keep the budget model identical to
    // the actual mutateWithAudit batch instead of treating them as post-audit
    // work (which would under/over-count depending on event count).
    const queueStatementCount = Math.ceil(
      eventIds.size / STATIC_REBUILD_BULK_UPSERT_ROWS,
    );
    const budget = planD1AuditMutationBudget({
      mutationStatementCount: accepted.length + queueStatementCount,
      mutationAssertionCount: accepted.length + queueStatementCount,
      auditEntryCount: slotCount,
      postAuditStatementCount: 0,
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

type XIdentityRequestRow = typeof xIdentityRequests.$inferSelect;

type SlotBindResult = {
  eventIds: string[];
  complete: boolean;
};

type SlotBindCasToken = {
  updatedAt: number;
  attemptCount: number;
};

function isSlotBindRequestType(
  value: XIdentityRequestRow["request_type"],
): value is (typeof SLOT_BIND_REQUEST_TYPES)[number] {
  return (SLOT_BIND_REQUEST_TYPES as readonly string[]).includes(value);
}

async function canonicalizeReservationBindCandidates(
  db: DB,
  values: readonly (string | null | undefined)[],
): Promise<string[]> {
  const normalizedValues = [
    ...new Set(
      values
        .map((value) => normalizeXId(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (normalizedValues.length === 0) return [];

  // resolveCanonicalXUserId は候補ごとに alias/exact の最大2 queryを発行
  // していた。承認直後はリンク・pending申請が多いユーザーもいるため、
  // ここをboundedな2段階IN lookupへまとめ、D1 statement budget超過を防ぐ。
  const aliasByInput = new Map<string, string>();
  for (
    let offset = 0;
    offset < normalizedValues.length;
    offset += RESERVATION_BIND_CANONICALIZE_CHUNK
  ) {
    const chunk = normalizedValues.slice(
      offset,
      offset + RESERVATION_BIND_CANONICALIZE_CHUNK,
    );
    const rows = await db
      .select({
        alias_x_id: xUserAliases.alias_x_id,
        x_user_id: xUserAliases.x_user_id,
      })
      .from(xUserAliases)
      .where(inArray(xUserAliases.alias_x_id, chunk));
    for (const row of rows) {
      // Preserve the resolver's first-row behavior for malformed duplicate
      // aliases while keeping the normalized input order below.
      if (!aliasByInput.has(row.alias_x_id)) {
        aliasByInput.set(row.alias_x_id, row.x_user_id);
      }
    }
  }

  const directIds = normalizedValues.filter((value) => !aliasByInput.has(value));
  const directById = new Map<string, { id: string; approval_status: string | null }>();
  for (
    let offset = 0;
    offset < directIds.length;
    offset += RESERVATION_BIND_CANONICALIZE_CHUNK
  ) {
    const chunk = directIds.slice(
      offset,
      offset + RESERVATION_BIND_CANONICALIZE_CHUNK,
    );
    const rows = await db
      .select({ id: xUsers.id, approval_status: xUsers.approval_status })
      .from(xUsers)
      .where(inArray(xUsers.id, chunk));
    for (const row of rows) directById.set(row.id, row);
  }

  return [
    ...new Set(
      normalizedValues.map((value) => {
        const alias = aliasByInput.get(value);
        if (alias) return alias;
        const direct = directById.get(value);
        // Match the existing helper's fail-closed fallback: unresolved or
        // rejected rows remain as the submitted normalized value so a pending
        // identity can still prevent unsafe NULL-snapshot auto-binding.
        return direct && direct.approval_status !== "rejected" ? direct.id : value;
      }),
    ),
  ];
}

/** 承認直後の正本を読み、null snapshot枠へ自動bindしてよいかを判定する。 */
async function canBindUnassignedSlotsAfterApproval(args: {
  db: DB;
  requestedAuthUserId: string;
  bindTargetXUserId: string;
}): Promise<boolean> {
  const [approvedRaw, pendingRows] = await Promise.all([
    getLinkedXUserIdsForAuthUser(args.db, args.requestedAuthUserId, {
      approvedOnly: true,
    }),
    args.db
      .select({ requested_x_id: xIdentityRequests.requested_x_id })
      .from(xIdentityRequests)
      .where(
        and(
          eq(
            xIdentityRequests.requested_by_auth_user_id,
            args.requestedAuthUserId,
          ),
          eq(xIdentityRequests.status, "pending"),
          inArray(xIdentityRequests.request_type, [...SLOT_BIND_REQUEST_TYPES]),
          isNotNull(xIdentityRequests.requested_x_id),
        )!,
      )
      .orderBy(
        desc(xIdentityRequests.requested_at),
        desc(xIdentityRequests.id),
      ),
  ]);
  const [approvedXIds, pendingXIds] = await Promise.all([
    canonicalizeReservationBindCandidates(args.db, approvedRaw),
    canonicalizeReservationBindCandidates(
      args.db,
      pendingRows.map((row) => row.requested_x_id),
    ),
  ]);
  return canAutoBindUnassignedReservation({
    bindTargetXId: args.bindTargetXUserId,
    approvedXIds,
    pendingXIds,
  });
}

async function markSlotBindAttempt(args: {
  db: DB;
  requestId: string;
  actorUserId: string;
  actorXUserId: string | null;
}): Promise<SlotBindCasToken | null> {
  const current = (
    await args.db
      .select()
      .from(xIdentityRequests)
      .where(eq(xIdentityRequests.id, args.requestId))
      .limit(1)
  )[0];
  if (
    !current ||
    current.status !== "approved" ||
    current.slot_bind_status !== "pending"
  ) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const slotBindVersionCondition =
    current.slot_bind_updated_at === null
      ? isNull(xIdentityRequests.slot_bind_updated_at)
      : eq(xIdentityRequests.slot_bind_updated_at, current.slot_bind_updated_at);
  const after = {
    ...current,
    slot_bind_attempt_count: current.slot_bind_attempt_count + 1,
    slot_bind_updated_at: now,
  };
  await mutateWithAudit(args.db, {
    mutationStatements: [
      args.db
        .update(xIdentityRequests)
        .set({
          slot_bind_attempt_count: sql`${xIdentityRequests.slot_bind_attempt_count} + 1`,
          slot_bind_updated_at: now,
        })
        .where(
          and(
            eq(xIdentityRequests.id, current.id),
            eq(xIdentityRequests.status, "approved"),
            eq(xIdentityRequests.slot_bind_status, "pending"),
            eq(
              xIdentityRequests.slot_bind_attempt_count,
              current.slot_bind_attempt_count,
            ),
            slotBindVersionCondition,
          )!,
        ),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "x_identity_requests",
        target_id: current.id,
        operation: "UPDATE",
        before: { ...current },
        after,
        actor_user_id: args.actorUserId,
        actor_x_user_id: args.actorXUserId,
        reason: "承認済みX IDの予約枠bindを開始",
        context: "x-identity-request:slot-bind",
        retention_class: "normal",
      },
    ],
  });
  return {
    updatedAt: now,
    attemptCount: current.slot_bind_attempt_count + 1,
  };
}

async function markSlotBindComplete(args: {
  db: DB;
  requestId: string;
  expectedSlotBindUpdatedAt: number | null;
  expectedSlotBindAttemptCount: number;
  actorUserId: string;
  actorXUserId: string | null;
}): Promise<boolean> {
  const current = (
    await args.db
      .select()
      .from(xIdentityRequests)
      .where(eq(xIdentityRequests.id, args.requestId))
      .limit(1)
  )[0];
  if (!current) return false;
  if (current.slot_bind_status === "complete") return true;
  if (current.status !== "approved" || current.slot_bind_status !== "pending") {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const slotBindVersionCondition =
    args.expectedSlotBindUpdatedAt === null
      ? isNull(xIdentityRequests.slot_bind_updated_at)
      : eq(xIdentityRequests.slot_bind_updated_at, args.expectedSlotBindUpdatedAt);
  const after = {
    ...current,
    slot_bind_status: "complete" as const,
    slot_bind_updated_at: now,
  };
  await mutateWithAudit(args.db, {
    mutationStatements: [
      args.db
        .update(xIdentityRequests)
        .set({
          slot_bind_status: "complete",
          slot_bind_updated_at: now,
        })
        .where(
          and(
            eq(xIdentityRequests.id, current.id),
            eq(xIdentityRequests.status, "approved"),
            eq(xIdentityRequests.slot_bind_status, "pending"),
            eq(
              xIdentityRequests.slot_bind_attempt_count,
              args.expectedSlotBindAttemptCount,
            ),
            slotBindVersionCondition,
          )!,
        ),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "x_identity_requests",
        target_id: current.id,
        operation: "UPDATE",
        before: { ...current },
        after,
        actor_user_id: args.actorUserId,
        actor_x_user_id: args.actorXUserId,
        reason: "承認済みX IDの予約枠bindを完了",
        context: "x-identity-request:slot-bind",
        retention_class: "normal",
      },
    ],
  });
  return true;
}

/**
 * Alias/slot bind は既存の正本を再利用するため、canonical resolver の
 * pending/imported 許容をそのまま使わず、公開可能な approved 行へ限定する。
 */
async function resolveApprovedCanonicalXUserId(
  db: DB,
  candidateXUserId: string | null | undefined,
): Promise<string | null> {
  const canonicalXUserId = await resolveCanonicalXUserId(db, candidateXUserId);
  if (!canonicalXUserId) return null;
  const row = (
    await db
      .select({ approval_status: xUsers.approval_status })
      .from(xUsers)
      .where(eq(xUsers.id, canonicalXUserId))
      .limit(1)
  )[0];
  return row?.approval_status === "approved" ? canonicalXUserId : null;
}

async function resolveApprovedSlotBindTarget(
  db: DB,
  request: XIdentityRequestRow,
): Promise<{ submittedXUserId: string; bindTargetXUserId: string } | null> {
  const submittedXUserId = normalizeXId(request.requested_x_id);
  if (!submittedXUserId || !isSlotBindRequestType(request.request_type)) {
    return null;
  }
  const bindTargetXUserId =
    request.request_type === "alias"
      ? await resolveApprovedCanonicalXUserId(db, request.target_x_user_id)
      : await resolveApprovedCanonicalXUserId(db, submittedXUserId);
  if (!bindTargetXUserId) return null;
  return { submittedXUserId, bindTargetXUserId };
}

async function bindReservedSlotsOnXApproval(args: {
  db: DB;
  requestId: string;
  requestedAuthUserId: string;
  submittedXUserId: string;
  bindTargetXUserId: string;
  operatorAuthUserId: string;
  operatorActorXUserId: string | null;
}): Promise<SlotBindResult> {
  const allowNullSnapshot = await canBindUnassignedSlotsAfterApproval({
    db: args.db,
    requestedAuthUserId: args.requestedAuthUserId,
    bindTargetXUserId: args.bindTargetXUserId,
  });
  // Migration 0053 preserves legacy raw snapshots.  New reservations store
  // normalized IDs, but old rows may still contain casing, @ prefixes, or
  // surrounding whitespace.  Match by the same identity key as normalizeXId
  // so an approved reservation is not stranded during bind/recovery.
  const normalizedSnapshotCondition = sql`
    lower(trim(ltrim(${slots.reserved_x_id_snapshot}, '@'))) = ${args.submittedXUserId}
  `;
  const snapshotCondition = allowNullSnapshot
    ? or(
        isNull(slots.reserved_x_id_snapshot),
        normalizedSnapshotCondition,
      )!
    : normalizedSnapshotCondition;
  const allAffectedEventIds = new Set<string>();
  let complete = false;
  // Keep the CAS token owned by this binder. Re-reading the latest token at
  // completion could let a concurrent retry complete a request while new
  // unbound reservations are still being added.
  let lastSlotBindToken: SlotBindCasToken | null = null;

  for (let page = 0; page < MAX_SLOT_BIND_PAGES_PER_REQUEST; page += 1) {
    const candidateRows = await args.db
      .select()
      .from(slots)
      .where(
        and(
          eq(slots.reserved_by_user_id, args.requestedAuthUserId),
          eq(slots.status, "reserved"),
          isNull(slots.x_user_id),
          snapshotCondition,
        )!,
      )
      .orderBy(
        asc(slots.event_id),
        asc(slots.start_time),
        asc(slots.sort_order),
        asc(slots.id),
      )
      .limit(RESERVED_SLOT_BIND_CAP);

    if (candidateRows.length === 0) {
      complete = true;
      break;
    }

    const bindUpdatedAt = await markSlotBindAttempt({
      db: args.db,
      requestId: args.requestId,
      actorUserId: args.operatorAuthUserId,
      actorXUserId: args.operatorActorXUserId,
    });
    if (bindUpdatedAt === null) break;
    lastSlotBindToken = bindUpdatedAt;

    const allChunks = groupSlotBindChunks(candidateRows);
    const { chunks, deferred } = planSlotBindBatchBudget(allChunks);
    if (chunks.length === 0) {
      console.warn(
        "[xid-admin] reserved slot bind deferred due to D1 batch budget",
        { deferred: candidateRows.length, cap: RESERVED_SLOT_BIND_CAP },
      );
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

    if (deferred > 0) {
      console.warn(
        "[xid-admin] reserved slot bind deferred due to D1 batch budget",
        {
          deferred,
          cap: RESERVED_SLOT_BIND_CAP,
        },
      );
      break;
    }

    // 成功した行は x_user_id IS NULL 条件から外れるため、次のpageへ進む。
    // page上限に達した場合はpendingのまま次回recoveryへ渡す。
    if (page === MAX_SLOT_BIND_PAGES_PER_REQUEST - 1) break;
  }

  if (complete) {
    let expectedSlotBindUpdatedAt = lastSlotBindToken?.updatedAt ?? null;
    let expectedSlotBindAttemptCount = lastSlotBindToken?.attemptCount ?? null;
    if (lastSlotBindToken === null) {
      const current = (
        await args.db
          .select({
            slot_bind_updated_at: xIdentityRequests.slot_bind_updated_at,
            slot_bind_attempt_count: xIdentityRequests.slot_bind_attempt_count,
          })
          .from(xIdentityRequests)
          .where(eq(xIdentityRequests.id, args.requestId))
          .limit(1)
      )[0];
      expectedSlotBindUpdatedAt = current?.slot_bind_updated_at ?? null;
      expectedSlotBindAttemptCount = current?.slot_bind_attempt_count ?? null;
    }
    if (
      expectedSlotBindAttemptCount !== null &&
      (expectedSlotBindUpdatedAt !== null || lastSlotBindToken === null)
    ) {
      await markSlotBindComplete({
        db: args.db,
        requestId: args.requestId,
        expectedSlotBindUpdatedAt,
        expectedSlotBindAttemptCount,
        actorUserId: args.operatorAuthUserId,
        actorXUserId: args.operatorActorXUserId,
      });
    }
  }

  return { eventIds: [...allAffectedEventIds], complete };
}

async function retryApprovedSlotBind(
  operator: XIdLinkOperator,
  request: XIdentityRequestRow,
): Promise<string[]> {
  if (!isSlotBindRequestType(request.request_type)) {
    // slot_bind_status is only meaningful for link/alias requests. If a
    // malformed legacy row is marked pending, close it safely without
    // touching any reservation rather than leaving recovery permanently stuck.
    const current = (
      await operator.db
        .select({
          slot_bind_updated_at: xIdentityRequests.slot_bind_updated_at,
          slot_bind_attempt_count: xIdentityRequests.slot_bind_attempt_count,
        })
        .from(xIdentityRequests)
        .where(eq(xIdentityRequests.id, request.id))
        .limit(1)
    )[0];
    if (current) {
      await markSlotBindComplete({
        db: operator.db,
        requestId: request.id,
        expectedSlotBindUpdatedAt: current.slot_bind_updated_at,
        expectedSlotBindAttemptCount: current.slot_bind_attempt_count,
        actorUserId: operator.authUserId,
        actorXUserId: operator.actorXUserId,
      });
    }
    return [];
  }
  const target = await resolveApprovedSlotBindTarget(operator.db, request);
  if (!target) {
    // 統合後に旧Xが正本から消えた等、安全なbind先がない場合は、
    // null枠を別名義へ寄せず「実行すべき自動bindなし」として完了にする。
    const current = (
      await operator.db
        .select({
          slot_bind_updated_at: xIdentityRequests.slot_bind_updated_at,
          slot_bind_attempt_count: xIdentityRequests.slot_bind_attempt_count,
        })
        .from(xIdentityRequests)
        .where(eq(xIdentityRequests.id, request.id))
        .limit(1)
    )[0];
    if (current) {
      await markSlotBindComplete({
        db: operator.db,
        requestId: request.id,
        expectedSlotBindUpdatedAt: current.slot_bind_updated_at,
        expectedSlotBindAttemptCount: current.slot_bind_attempt_count,
        actorUserId: operator.authUserId,
        actorXUserId: operator.actorXUserId,
      });
    }
    return [];
  }
  const result = await bindReservedSlotsOnXApproval({
    db: operator.db,
    requestId: request.id,
    requestedAuthUserId: request.requested_by_auth_user_id,
    submittedXUserId: target.submittedXUserId,
    bindTargetXUserId: target.bindTargetXUserId,
    operatorAuthUserId: operator.authUserId,
    operatorActorXUserId: operator.actorXUserId,
  });
  return result.eventIds;
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
    if (
      request.status === "approved" &&
      request.slot_bind_status === "pending"
    ) {
      const slotBindEventIds = await retryApprovedSlotBind(operator, request);
      await runXIdAdminPostCommit("xid-admin.retryApprovedSlotBind", () => {
        revalidateIdentityAdminPaths();
        for (const eventId of slotBindEventIds) {
          revalidatePath(`/event/${eventId}/slots`);
        }
      });
      return {
        ok: true,
        message: "承認済み申請の予約枠反映を再試行しました。",
      };
    }
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
  let requesterPostApprovalActiveX: {
    activeXId: string;
    activeXName: string | null;
  } | null = null;

  if (request.request_type === "alias") {
    const targetXUserId = await resolveApprovedCanonicalXUserId(
      db,
      request.target_x_user_id,
    );
    if (!submittedXUserId || !targetXUserId) {
      return { ok: false, message: "別名申請のX IDまたは追加先が不足しています。" };
    }
    bindTargetXUserId = targetXUserId;
    if (!(await isApprovedLinkedXUser(db, requestedAuthUserId, targetXUserId))) {
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
      requesterPostApprovalActiveX = {
        activeXId: effectiveXUserId,
        activeXName: xUser?.x_name ?? `@${effectiveXUserId}`,
      };
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
    slot_bind_status: "pending" as const,
    slot_bind_updated_at: now,
    updated_at: now,
    ...decisionFields,
  };
  statements.push(
    db
      .update(xIdentityRequests)
      .set({
        status: "approved",
        slot_bind_status: "pending",
        slot_bind_updated_at: now,
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
  const {
    overlayNotificationActorActiveX,
    resolveNotificationActor,
  } = await import("@/lib/notifications/actor");
  const {
    buildChannelXIdApprovedNotification,
    buildXIdApproveThreadName,
  } = await import("@/lib/notifications/templates/xidChannel");
  const { buildOpsChannelWebhookStatement } = await import(
    "@/lib/notifications/opsWebhook"
  );
  const requester = overlayNotificationActorActiveX(
    await resolveNotificationActor(db, requestedAuthUserId),
    requesterPostApprovalActiveX,
  );
  const operatorActor = await resolveNotificationActor(db, operatorAuthUserId);
  const approveXIdLabel =
    submittedXUserId ??
    request.requested_x_id ??
    request.source_x_user_id ??
    "不明";
  const channelNotification = await buildOpsChannelWebhookStatement(db, {
    target: "account",
    threadName: buildXIdApproveThreadName(approveXIdLabel, requester),
    actorUserId: operatorAuthUserId,
    payload: buildChannelXIdApprovedNotification({
      requestId: request.id,
      requestType: request.request_type,
      requestedXId: request.requested_x_id,
      sourceXUserId: request.source_x_user_id,
      targetXUserId: request.target_x_user_id,
      requester,
      operator: operatorActor,
      approvedAt: now,
    }),
    dedupeKey: `xid_approve_webhook:${request.id}`,
  });
  if (notification) {
    statements.push(notification.statement);
    expected.push(null);
  }
  if (channelNotification) {
    statements.push(channelNotification.statement);
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

  // 別名（alias）追加・pending x_users作成は公開可否変化と無関係に
  // member suggestions indexの候補へ響くため、常に同一atomic batchで再生成する。
  if (notificationXUserId || bindTargetXUserId) {
    const suggestionsQueue = await buildStaticRebuildQueueBatch(db, [
      {
        targetType: "member_suggestions",
        targetId: "global",
        reason: "x_id_approved",
        priority: "low",
      },
    ]);
    statements.push(...suggestionsQueue.statements);
    expected.push(...suggestionsQueue.expectedChanges);
  }

  await mutateWithAudit(db, {
    mutationStatements: statements,
    expectedMutationChanges: expected,
    audits,
    notificationWakeSource:
      notification || channelNotification ? "admin" : undefined,
    staticRebuildWakeSource:
      publicVisibilityChanged && notificationXUserId ? "admin" : undefined,
  });

  let slotBindEventIds: string[] = [];
  if (bindTargetXUserId && submittedXUserId) {
    const slotBindResult = await bindReservedSlotsOnXApproval({
      db,
      requestId: request.id,
      requestedAuthUserId,
      submittedXUserId,
      bindTargetXUserId,
      operatorAuthUserId,
      operatorActorXUserId,
    });
    slotBindEventIds = slotBindResult.eventIds;
  } else {
    // 承認済みだが安全なbind先がない異常データは、予約枠を変更せずに
    // completeへ進め、recoveryが同じ曖昧状態を永久再試行しないようにする。
    const current = (
      await db
        .select({
          slot_bind_updated_at: xIdentityRequests.slot_bind_updated_at,
          slot_bind_attempt_count: xIdentityRequests.slot_bind_attempt_count,
        })
        .from(xIdentityRequests)
        .where(eq(xIdentityRequests.id, request.id))
        .limit(1)
    )[0];
    if (current) {
      await markSlotBindComplete({
        db,
        requestId: request.id,
        expectedSlotBindUpdatedAt: current.slot_bind_updated_at,
        expectedSlotBindAttemptCount: current.slot_bind_attempt_count,
        actorUserId: operatorAuthUserId,
        actorXUserId: operatorActorXUserId,
      });
    }
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
            .select({
              status: xIdentityRequests.status,
              slot_bind_status: xIdentityRequests.slot_bind_status,
            })
            .from(xIdentityRequests)
            .where(eq(xIdentityRequests.id, requestId))
            .limit(1)
        )[0];
        if (!current) return { ok: false, message: "申請が見つかりません。" };
        if (
          current.status === "approved" &&
          current.slot_bind_status === "pending" &&
          attempt === 0
        ) {
          // identity transactionはcommit済みでもslot bindだけ失敗し得る。
          // approvedを「処理済み」とみなして終わらせず、同じAction内で1回だけ再試行する。
          continue;
        }
        if (
          current.status === "approved" &&
          current.slot_bind_status === "pending"
        ) {
          return {
            ok: false,
            message: "承認は完了しましたが、予約枠の反映は再試行待ちです。",
          };
        }
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
  const { resolveNotificationActor } = await import(
    "@/lib/notifications/actor"
  );
  const {
    buildChannelXIdRejectedNotification,
    buildXIdRejectThreadName,
  } = await import("@/lib/notifications/templates/xidChannel");
  const { buildOpsChannelWebhookStatement } = await import(
    "@/lib/notifications/opsWebhook"
  );
  const requester = await resolveNotificationActor(
    db,
    request.requested_by_auth_user_id,
  );
  const operatorActor = await resolveNotificationActor(db, operatorAuthUserId);
  const rejectXIdLabel =
    request.requested_x_id ?? request.source_x_user_id ?? "不明";
  const channelNotification = await buildOpsChannelWebhookStatement(db, {
    target: "account",
    threadName: buildXIdRejectThreadName(rejectXIdLabel, requester),
    actorUserId: operatorAuthUserId,
    payload: buildChannelXIdRejectedNotification({
      requestId: request.id,
      requestType: request.request_type,
      requestedXId: request.requested_x_id,
      sourceXUserId: request.source_x_user_id,
      targetXUserId: request.target_x_user_id,
      requester,
      operator: operatorActor,
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
