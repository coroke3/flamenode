/**
 * SA-074..076: a user has already accepted the latest terms only when the
 * accepted version matches, ToS is accepted and no re-accept is pending
 * (moved from src/lib/actions/terms.ts). The CAS on the same columns stays in
 * the action.
 */
export function isLatestTermsAlreadyAccepted(
  userBefore: {
    accepted_terms_version_id: string | null;
    is_tos_accepted: number | null;
    terms_reaccept_required: number | null;
  },
  termsVersionId: string,
): boolean {
  return (
    userBefore.accepted_terms_version_id === termsVersionId &&
    (userBefore.is_tos_accepted ?? 0) === 1 &&
    (userBefore.terms_reaccept_required ?? 0) === 0
  );
}
