import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { users, xIdentityRequests, xUsers } from "@flamenode/db/schema";
import { buildXIdentityDecisionFields } from "@flamenode/domain/xid";
import type { ServerCoreDb } from "../db.ts";
import type { AtomicAuditMutationInput } from "../audit/mutate.ts";
import { expectedRowCondition } from "../audit/expectedRowCondition.ts";

/**
 * SA-091 rejection: the CURRENT pending-status CAS and strict atomic audit
 * input. Hosts authorize and read the request first, then build the optional
 * outbox statements. This planner performs no reads, writes, or Queue wakes.
 * Audit attribution is explicit: never infer a selected X from actorUserId
 * or replace null. The CURRENT and TARGET hosts own their attribution policy.
 */
export function planXIdLinkRejection(
  db: ServerCoreDb,
  input: {
    request: typeof xIdentityRequests.$inferSelect;
    actorUserId: string;
    actorXUserId: string | null;
    reason: string;
    now: number;
    notificationStatements: readonly BatchItem<"sqlite">[];
  },
): AtomicAuditMutationInput {
  const { request, actorUserId, actorXUserId, reason, now, notificationStatements } = input;
  if (request.status !== "pending" || request.request_type === "merge" || request.request_type === "revert_merge") {
    throw new Error("Invalid link-request rejection plan");
  }
  const decisionReason = reason || "X ID申請を却下";
  const decisionFields = buildXIdentityDecisionFields({
    decidedByAuthUserId: actorUserId,
    decisionReason,
    decidedAt: now,
  });
  const update = {
    status: "rejected" as const,
    updated_at: now,
    ...decisionFields,
  };
  return {
    mutationStatements: [
      db.update(xIdentityRequests).set(update).where(
        and(
          eq(xIdentityRequests.id, request.id),
          eq(xIdentityRequests.status, "pending"),
        )!,
      ),
      ...notificationStatements,
    ],
    expectedMutationChanges: [1, ...notificationStatements.map(() => null)],
    audits: [{
      table_name: "x_identity_requests",
      target_id: request.id,
      operation: "UPDATE",
      before: { ...request },
      after: { ...request, ...update },
      actor_user_id: actorUserId,
      actor_x_user_id: actorXUserId,
      reason: decisionReason,
      context: "x-identity-request",
      retention_class: "long_audit",
    }],
  };
}

/**
 * SA-090 alias approval: assemble the CURRENT conditional insert and its
 * audit entry. Host authorization, canonical/linked identity reads and the
 * surrounding pending-request CAS remain in the host transaction.
 * A zero-row insert must abort the atomic batch; this helper never executes it.
 */
export function planXIdAliasApproval(
  db: ServerCoreDb,
  input: {
    targetXUserId: string;
    submittedXUserId: string;
    actorUserId: string;
    actorXUserId: string | null;
  },
) {
  const { targetXUserId, submittedXUserId, actorUserId, actorXUserId } = input;
  const alias = { x_user_id: targetXUserId, alias_x_id: submittedXUserId };
  // The host's preceding reads are advisory. This exact conditional INSERT
  // rejects a concurrent canonical/alias collision or loss of target approval.
  return {
    statement: db.run(sql`
      INSERT INTO x_user_aliases (x_user_id, alias_x_id)
      SELECT ${targetXUserId}, ${submittedXUserId}
      WHERE EXISTS (
        SELECT 1 FROM x_users
        WHERE id = ${targetXUserId}
          AND approval_status = 'approved'
      )
      AND NOT EXISTS (
        SELECT 1 FROM x_users
        WHERE lower(trim(ltrim(trim(id), '@'))) = lower(${submittedXUserId})
      )
      AND NOT EXISTS (
        SELECT 1 FROM x_user_aliases
        WHERE lower(trim(ltrim(trim(alias_x_id), '@'))) = lower(${submittedXUserId})
      )
    `),
    expectedChanges: 1 as const,
    audit: {
      table_name: "x_user_aliases",
      target_id: `${targetXUserId}:${submittedXUserId}`,
      operation: "CREATE",
      before: null,
      after: alias,
      actor_user_id: actorUserId,
      actor_x_user_id: actorXUserId,
      reason: "X名義の別名申請を承認",
      context: "x-identity-request",
      retention_class: "long_audit",
    } satisfies AtomicAuditMutationInput["audits"][number],
  };
}

/**
 * SA-090 canonical X user approval: plan a new row or re-approve the
 * exact previously read row. An already approved row needs no mutation.
 * Hosts retain canonical resolution, link/request CAS and batch execution.
 */
export function planXIdCanonicalApproval(
  db: ServerCoreDb,
  input: {
    effectiveXUserId: string;
    xUser: typeof xUsers.$inferSelect | null;
    actorUserId: string;
    actorXUserId: string | null;
  },
): {
  statement: BatchItem<"sqlite">;
  expectedChanges: 1;
  audit: AtomicAuditMutationInput["audits"][number];
} | null {
  const { effectiveXUserId, xUser, actorUserId, actorXUserId } = input;
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
    return {
      statement: db.insert(xUsers).values(newXUser),
      expectedChanges: 1,
      audit: {
        table_name: "x_users",
        target_id: effectiveXUserId,
        operation: "CREATE",
        before: null,
        after: newXUser,
        actor_user_id: actorUserId,
        actor_x_user_id: actorXUserId,
        reason: "新規X名義申請を承認",
        context: "x-identity-request",
        retention_class: "long_audit",
      },
    };
  }
  if (xUser.approval_status === "approved") return null;
  return {
    statement: db
      .update(xUsers)
      .set({ approval_status: "approved" })
      .where(expectedRowCondition({ expectedCurrent: xUser })),
    expectedChanges: 1,
    audit: {
      table_name: "x_users",
      target_id: effectiveXUserId,
      operation: "UPDATE",
      before: { ...xUser },
      after: { ...xUser, approval_status: "approved" },
      actor_user_id: actorUserId,
      actor_x_user_id: actorXUserId,
      reason: "既存X名義の連携申請を承認",
      context: "x-identity-request",
      retention_class: "long_audit",
    },
  };
}

/**
 * SA-090 initial Active X selection: preserve the CURRENT full-row CAS and
 * notification actor overlay. A missing user or existing selection is a no-op.
 * The host owns all authorization, account linking and batch execution.
 */
export function planXIdInitialActiveSelection(
  db: ServerCoreDb,
  input: {
    authUser: typeof users.$inferSelect | null;
    effectiveXUserId: string;
    requestedAuthUserId: string;
    xName: string | null;
    actorUserId: string;
    actorXUserId: string | null;
  },
): {
  statement: BatchItem<"sqlite">;
  expectedChanges: 1;
  audit: AtomicAuditMutationInput["audits"][number];
  notificationActiveX: { activeXId: string; activeXName: string | null };
} | null {
  const { authUser, effectiveXUserId, requestedAuthUserId, xName, actorUserId, actorXUserId } = input;
  if (!authUser || authUser.active_x_user_id) return null;
  const afterUser = { ...authUser, active_x_user_id: effectiveXUserId };
  return {
    statement: db
      .update(users)
      .set({ active_x_user_id: effectiveXUserId })
      .where(expectedRowCondition({ expectedCurrent: authUser })),
    expectedChanges: 1,
    audit: {
      table_name: "user",
      target_id: requestedAuthUserId,
      operation: "UPDATE",
      before: { ...authUser },
      after: afterUser,
      actor_user_id: actorUserId,
      actor_x_user_id: actorXUserId,
      reason: "初回連携X名義をアクティブに設定",
      context: "x-identity-request",
      retention_class: "normal",
    },
    notificationActiveX: {
      activeXId: effectiveXUserId,
      activeXName: xName ?? `@${effectiveXUserId}`,
    },
  };
}
