/**
 * MIG-0641 U01e: SA-074 consent SQL adapter.
 *
 * The Hono write route must authorize an unaccepted user, verify same-origin,
 * enforce the eventual terms CostGuard policy, and load the CURRENT snapshots
 * before invoking this. Nothing is registered on an HTTP route here.
 *
 * Audit and every mutation share mutateWithAudit's D1 batch. No bare db.run
 * call executes a statement outside the atomic audit boundary.
 */
import type { ServerCoreDb } from "@flamenode/server-core/db";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import {
  mutateWithAudit,
  type AtomicAuditMutationInput,
} from "@flamenode/server-core/audit/mutate";
import { sql, type SQL } from "@flamenode/server-core/sql";
import type { TermsConsentPlan } from "./termsConsentPlan.ts";

type MutationPlan = Extract<TermsConsentPlan, { kind: "mutate" }>;

export function buildTermsMutationSql(plan: MutationPlan): readonly SQL[] {
  const mutation: SQL[] = [];
  if (plan.insertConsent) {
    const consent = plan.insertConsent;
    mutation.push(sql`INSERT INTO "user_tos_consents"
      ("id", "user_id", "terms_version_id", "consented_at", "consent_context")
      VALUES (${consent.id}, ${consent.user_id}, ${consent.terms_version_id},
        ${consent.consented_at}, ${consent.consent_context})`);
  }
  mutation.push(sql`UPDATE "user"
    SET "is_tos_accepted" = 1,
        "accepted_terms_version_id" = ${plan.userAfter.accepted_terms_version_id},
        "terms_reaccept_required" = 0
    WHERE ${expectedRowCondition({ expectedCurrent: plan.casExpected })}`);
  return mutation;
}

export async function commitPlannedTermsConsent(
  db: ServerCoreDb,
  plan: TermsConsentPlan,
  options: Pick<AtomicAuditMutationInput, "preloaded" | "callerQueryCount"> = {},
): Promise<"accepted" | "already_accepted"> {
  if (plan.kind === "already_accepted") return "already_accepted";
  const mutationStatements = buildTermsMutationSql(plan).map((statement) => db.run(statement));
  await mutateWithAudit(db, {
    mutationStatements,
    expectedMutationChanges: plan.expectedMutationChanges,
    audits: plan.audits,
    preloaded: options.preloaded,
    callerQueryCount: options.callerQueryCount,
  });
  return "accepted";
}
