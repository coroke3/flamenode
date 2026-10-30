/**
 * MIG-0641 U01g: compose CURRENT SA-074 one-read snapshot, CAS plan and the
 * strictly audited D1 mutation. No HTTP entrypoint is registered here.
 *
 * The injected seam permits deterministic race/error regression tests without
 * weakening the underlying D1 batch and origin/session/CostGuard prerequisites.
 */
import { isLatestTermsAlreadyAccepted } from "@flamenode/domain/user";
import { AuditMutationError, type AtomicAuditMutationInput } from "@flamenode/server-core/audit/mutate";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import { generateId } from "@flamenode/server-core/id";
import type { TermsCommitOutcome } from "./termsDecision.ts";
import { planTermsConsent, type TermsConsentPlan } from "./termsConsentPlan.ts";
import { loadTermsSnapshot, type TermsSnapshot } from "./termsSnapshot.ts";
import { commitPlannedTermsConsent } from "./termsAtomic.ts";

export type TermsCommitPort = {
  load(userId: string): Promise<TermsSnapshot | null>;
  commit(plan: TermsConsentPlan): Promise<"accepted" | "already_accepted">;
  generateConsentId(): string;
  now(): number;
};

export type TermsCommitHostOptions = {
  preloaded?: AtomicAuditMutationInput["preloaded"];
  /** Include the session/CostGuard reads and the one snapshot query. */
  callerQueryCount: number;
};

export function createTermsCommitPort(
  d1: Pick<D1Database, "prepare">,
  db: ServerCoreDb,
  options: TermsCommitHostOptions,
): TermsCommitPort {
  return {
    load: (userId) => loadTermsSnapshot(d1, userId),
    commit: (plan) => commitPlannedTermsConsent(db, plan, {
      preloaded: options.preloaded,
      callerQueryCount: options.callerQueryCount,
    }),
    generateConsentId: () => generateId("tos"),
    now: () => Math.floor(Date.now() / 1000),
  };
}

/**
 * Only a host-verified session id is permitted. These results are not
 * authentication decisions and do not replace same-origin or CostGuard checks.
 */
export async function commitLatestTermsForUser(
  port: TermsCommitPort,
  authenticatedUserId: string | null,
): Promise<TermsCommitOutcome> {
  if (!authenticatedUserId) return { kind: "not_authenticated" };
  let snapshot: TermsSnapshot | null;
  try {
    snapshot = await port.load(authenticatedUserId);
  } catch {
    return { kind: "database_unavailable", retryable: true };
  }
  if (!snapshot) return { kind: "user_missing" };
  // The caller must never be able to accept terms for a different account.
  if (snapshot.userBefore.id !== authenticatedUserId) {
    return { kind: "database_unavailable", retryable: true };
  }

  const { termsVersionId, userBefore, existingConsentId } = snapshot;
  if (isLatestTermsAlreadyAccepted(userBefore, termsVersionId)) {
    return { kind: "already_accepted", termsVersionId };
  }

  let plan: TermsConsentPlan;
  try {
    plan = planTermsConsent({
      userBefore,
      termsVersionId,
      existingConsentId,
      generatedConsentId: port.generateConsentId(),
      now: port.now(),
    });
  } catch {
    return { kind: "commit_failed" };
  }

  try {
    await port.commit(plan);
    return { kind: "accepted", termsVersionId };
  } catch (error) {
    if (!(error instanceof AuditMutationError)) {
      // Never reflect raw SQL/D1/internal errors in the API response.
      return { kind: "commit_failed" };
    }
    // CURRENT: a failed CAS may mean the concurrent request already accepted.
    // One bounded re-read distinguishes idempotent success from real conflict.
    let after: TermsSnapshot | null;
    try {
      after = await port.load(authenticatedUserId);
    } catch {
      return { kind: "database_unavailable", retryable: true };
    }
    if (after && after.userBefore.id === authenticatedUserId &&
      isLatestTermsAlreadyAccepted(after.userBefore, termsVersionId)) {
      return { kind: "already_accepted", termsVersionId };
    }
    return { kind: "concurrent_update", retryable: true };
  }
}
