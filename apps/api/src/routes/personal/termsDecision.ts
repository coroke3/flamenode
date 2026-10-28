/**
 * MIG-0641 U01c: pure CURRENT SA-075 / SA-076 response projections.
 * Route handlers must still authenticate, enforce Origin+banned+CostGuard and
 * run SA-074 equivalent atomic consent + audit before calling these.
 * Nothing in this module executes SQL, grants access or bypasses write guards.
 */
import type {
  AcceptLatestTermsResponse,
  OnboardingTermsAcceptResponse,
} from "@flamenode/contracts";
import { sanitizeTermsNextPath } from "./termsNext.ts";

export type TermsCommitOutcome =
  | { kind: "accepted" | "already_accepted"; termsVersionId: string }
  | { kind: "not_authenticated" | "user_missing" | "terms_unavailable" }
  | { kind: "database_unavailable" | "concurrent_update"; retryable: true }
  | { kind: "commit_failed" };

const ONBOARDING_RETRY_MESSAGE =
  "保存を完了できませんでした。再読み込み後にもう一度お試しください。同意済みの可能性があります。";

export function projectOnboardingTerms(
  result: TermsCommitOutcome,
): OnboardingTermsAcceptResponse {
  if (result.kind === "accepted" || result.kind === "already_accepted") {
    return { ok: true, alreadyAccepted: result.kind === "already_accepted" };
  }
  if (result.kind === "database_unavailable" || result.kind === "concurrent_update") {
    return { ok: false, message: ONBOARDING_RETRY_MESSAGE, retryable: true };
  }
  if (result.kind === "terms_unavailable") {
    return { ok: false, message: "利用規約を取得できませんでした。" };
  }
  if (result.kind === "commit_failed") {
    return { ok: false, message: "同意の保存に失敗しました。時間をおいて再試行してください。", retryable: true };
  }
  return { ok: false, message: "利用規約への同意を完了できませんでした。" };
}

/** Maps SA-075's redirect targets to a JSON navigation target for the SPA. */
export function projectLatestTerms(
  result: TermsCommitOutcome,
  rawNext: string | null | undefined,
): AcceptLatestTermsResponse {
  const next = sanitizeTermsNextPath(rawNext);
  if (result.kind === "accepted" || result.kind === "already_accepted") {
    return { ok: true, next };
  }
  if (result.kind === "not_authenticated" || result.kind === "user_missing") {
    return { ok: false, next: `/entry?next=${encodeURIComponent(next)}` };
  }
  const error = result.kind === "commit_failed" ? "terms_commit_failed" : result.kind;
  return {
    ok: false,
    next: `/rules?next=${encodeURIComponent(next)}&error=${encodeURIComponent(error)}`,
  };
}

/** CURRENT maybeMarkOnboardingComplete: never update for no X request or rejected X. */
export function canMarkOnboardingComplete(
  xIdentityStatus: "none" | "pending" | "approved" | "rejected",
): boolean {
  return xIdentityStatus === "pending" || xIdentityStatus === "approved";
}
