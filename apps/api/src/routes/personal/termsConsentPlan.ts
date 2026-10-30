/**
 * MIG-0641 U01d: CURRENT SA-074 pure consent/Audit CAS plan.
 *
 * Snapshot construction is deliberately separate from Hono/D1. The guarded
 * write handler still needs to perform the same atomic CAS + strict audit
 * batch before returning success. No SQL or network activity occurs here.
 */
import { isLatestTermsAlreadyAccepted } from "@flamenode/domain/user";

export type TermsUserSnapshot = {
  id: string;
  accepted_terms_version_id: string | null;
  is_tos_accepted: number | null;
  terms_reaccept_required: number | null;
  [column: string]: unknown;
};

export type ConsentSnapshot = {
  id: string;
  user_id: string;
  terms_version_id: string;
  consented_at: number;
  consent_context: "entry";
};

export type TermsConsentAudit = {
  table_name: "user" | "user_tos_consents";
  target_id: string;
  operation: "CREATE" | "UPDATE";
  before?: TermsUserSnapshot;
  after: TermsUserSnapshot | ConsentSnapshot;
  actor_user_id: string;
  retention_class: "long_audit";
  context: "terms_accept";
  reason: string;
  strict: true;
};

export type TermsConsentPlan =
  | { kind: "already_accepted" }
  | {
      kind: "mutate";
      /** CURRENT's CAS snapshot, with nullable flags mapped to zero. */
      casExpected: {
        id: string;
        accepted_terms_version_id: string | null;
        is_tos_accepted: number;
        terms_reaccept_required: number;
      };
      insertConsent: ConsentSnapshot | null;
      userAfter: TermsUserSnapshot;
      expectedMutationChanges: readonly number[];
      audits: readonly TermsConsentAudit[];
    };

export function planTermsConsent(input: {
  userBefore: TermsUserSnapshot;
  termsVersionId: string;
  existingConsentId: string | null;
  generatedConsentId: string;
  now: number;
}): TermsConsentPlan {
  const { userBefore, termsVersionId, existingConsentId, generatedConsentId, now } = input;
  if (isLatestTermsAlreadyAccepted(userBefore, termsVersionId)) {
    return { kind: "already_accepted" };
  }
  const userId = userBefore.id;
  const consentAfter: ConsentSnapshot = {
    id: existingConsentId ?? generatedConsentId,
    user_id: userId,
    terms_version_id: termsVersionId,
    consented_at: now,
    consent_context: "entry",
  };
  const userAfter: TermsUserSnapshot = {
    ...userBefore,
    is_tos_accepted: 1,
    accepted_terms_version_id: termsVersionId,
    terms_reaccept_required: 0,
  };
  const createConsent = existingConsentId === null;
  const userAudit: TermsConsentAudit = {
    table_name: "user",
    target_id: userId,
    operation: "UPDATE",
    before: { ...userBefore },
    after: { ...userAfter },
    actor_user_id: userId,
    retention_class: "long_audit",
    context: "terms_accept",
    reason: createConsent
      ? `規約 ${termsVersionId} への同意状態更新`
      : `規約 ${termsVersionId} への同意状態修復`,
    strict: true,
  };
  const consentAudit: TermsConsentAudit = {
    table_name: "user_tos_consents",
    target_id: consentAfter.id,
    operation: "CREATE",
    after: { ...consentAfter },
    actor_user_id: userId,
    retention_class: "long_audit",
    context: "terms_accept",
    reason: `規約 ${termsVersionId} への同意`,
    strict: true,
  };
  return {
    kind: "mutate",
    casExpected: {
      id: userId,
      accepted_terms_version_id: userBefore.accepted_terms_version_id,
      is_tos_accepted: userBefore.is_tos_accepted ?? 0,
      terms_reaccept_required: userBefore.terms_reaccept_required ?? 0,
    },
    insertConsent: createConsent ? consentAfter : null,
    userAfter,
    expectedMutationChanges: createConsent ? [1, 1] : [1],
    audits: createConsent ? [consentAudit, userAudit] : [userAudit],
  };
}
