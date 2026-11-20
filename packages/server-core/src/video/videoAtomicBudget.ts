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
  // A mismatched assertion vector would produce a falsely low D1 budget.
  // The existing Next executor checks this already; enforce the same invariant
  // for a future Hono caller before any optimistic query-count projection.
  if (plan.statements.length !== plan.expectedChanges.length) {
    throw new RangeError("video_atomic_expected_changes_mismatch");
  }
  // TypeScript cannot protect a runtime Hono caller or an array with sparse
  // slots. The atomic executor emits one changes() assertion per numeric slot:
  // undefined, NaN, fractional, negative or unsafe counts are not valid D1
  // mutation row-count expectations. Reject them before approving the budget.
  for (let index = 0; index < plan.expectedChanges.length; index += 1) {
    const expected = plan.expectedChanges[index];
    if (expected !== null && (!Number.isSafeInteger(expected) || expected < 0)) {
      throw new RangeError("video_atomic_invalid_expected_changes");
    }
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
