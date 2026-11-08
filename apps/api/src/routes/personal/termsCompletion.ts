/**
 * MIG-0641 U03a: CURRENT maybeMarkOnboardingComplete D1 mutation seam.
 * This must be invoked ONLY with a server-derived onboarding status, after
 * authenticated same-origin/banned/CostGuard checks in a future Hono handler.
 * A failed auxiliary marker must never block the user's screen/authorization.
 */
import { canMarkOnboardingComplete } from "./termsDecision.ts";

export type CompletionStatus = Parameters<typeof canMarkOnboardingComplete>[0];

export async function markOnboardingComplete(
  db: Pick<D1Database, "prepare">,
  authenticatedUserId: string,
  status: CompletionStatus,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!canMarkOnboardingComplete(status)) return false;
  try {
    // Exactly CURRENT's conditional UPDATE: no initial read and no overwrite.
    // Binding protects the authoritative session user id from SQL injection.
    await db
      .prepare(
        'UPDATE "user" SET "onboarding_completed_at" = ? WHERE "id" = ? AND "onboarding_completed_at" IS NULL',
      )
      .bind(now, authenticatedUserId)
      .run();
    return true;
  } catch {
    // CURRENT catches and ignores this auxiliary marker failure. Do not log
    // raw D1 error content (it may contain bound identifiers or private data).
    return false;
  }
}
