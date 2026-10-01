import {
  planAtomicAuditMutationBudget,
  type AtomicAuditMutationInput,
} from "@/lib/audit/mutate";

/**
 * Production entry point for the concrete merge/revert arrays.  It receives
 * the statements, assertions, audits and caller reads already built by the
 * flow, so the budget cannot drift into a second hand-maintained formula.
 */
export function planXIdMergeD1Budget(
  input: Parameters<typeof planAtomicAuditMutationBudget>[0],
) {
  return planAtomicAuditMutationBudget(input);
}

export type XIdMergeAtomicPlanInput = Pick<
  AtomicAuditMutationInput,
  | "mutationStatements"
  | "expectedMutationChanges"
  | "preMutationAssertions"
  | "postMutationAssertions"
  | "audits"
  | "postAuditStatements"
  | "callerQueryCount"
>;
