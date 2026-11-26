import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { xIdentityRequests } from "@flamenode/db/schema";
import { buildXIdentityDecisionFields } from "@flamenode/domain/xid";
import type { ServerCoreDb } from "../db.ts";
import type { AtomicAuditMutationInput } from "../audit/mutate.ts";

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
