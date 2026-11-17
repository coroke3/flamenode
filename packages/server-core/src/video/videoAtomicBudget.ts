/** MIG-0650 U03w: shared CURRENT/Hono video-atomic D1 budget.
 * Pure calculation only. A future Hono host MUST supply actual caller queries.
 */
import { planD1AuditMutationBudget, type D1AuditMutationBudget } from "../audit/mutateBudget.ts";
import type { WriteAuditLogInput } from "../audit/types.ts";

export type VideoAtomicBudgetPlan = {
  statements: readonly unknown[];
  expectedChanges: readonly (number | null)[];
  audits: readonly Pick<WriteAuditLogInput, "actor_user_id" | "actor_x_user_id">[];
};

export function inspectVideoAtomicWritePlanBudget(
  plan: VideoAtomicBudgetPlan,
  options: { callerQueryCount?: number } = {},
): D1AuditMutationBudget {
  // An explicit pre-read count is a safety claim, not a hint. The generic
  // D1 calculator normalizes negatives to zero: accepting that here could
  // undercount Hono reads and incorrectly approve a >50-query save plan.
  // NEXT omits this value and retains its conservative 18-query default.
  if (
    options.callerQueryCount !== undefined &&
    (!Number.isSafeInteger(options.callerQueryCount) || options.callerQueryCount < 0)
  ) {
    throw new RangeError("video_atomic_invalid_caller_query_count");
  }
  const actorXValidationQueryCount = plan.audits.some(
    audit => Boolean(audit.actor_x_user_id?.trim()),
  ) ? 1 : 0;
  return planD1AuditMutationBudget({
    mutationStatementCount: plan.statements.length,
    mutationAssertionCount: plan.expectedChanges.filter(expected => expected !== null).length,
    auditEntryCount: plan.audits.length,
    distinctActorCount: new Set(plan.audits.map(audit => audit.actor_user_id)).size,
    actorXValidationQueryCount,
    ...(options.callerQueryCount === undefined ? {} : { callerQueryCount: options.callerQueryCount }),
  });
}
