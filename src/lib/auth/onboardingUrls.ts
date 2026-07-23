import { sanitizeNextPath } from "@/lib/utils/next";
import type { WriteGuardDenyReason } from "./writeGuard";
import { entryLoginRedirectTo as authCompleteEntryLoginRedirectTo } from "./authComplete";

export function onboardingRulesHref(next: string): string {
  const safeNext = sanitizeNextPath(next, "/onboarding");
  return `/rules?next=${encodeURIComponent(safeNext)}`;
}

export function onboardingHref(next?: string): string {
  const safeNext = sanitizeNextPath(next, "/dashboard");
  return `/onboarding?next=${encodeURIComponent(safeNext)}`;
}

/** Discord signIn 後は軽量 /auth/complete を経由する。 */
export function entryLoginRedirectTo(next?: string): string {
  return authCompleteEntryLoginRedirectTo(next);
}