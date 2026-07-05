import { sanitizeNextPath } from "@/lib/utils/next";
import type { WriteGuardDenyReason } from "./writeGuard";

export function onboardingRulesHref(next: string): string {
  const safeNext = sanitizeNextPath(next, "/onboarding");
  return `/rules?next=${encodeURIComponent(safeNext)}`;
}

export function onboardingHref(next?: string): string {
  const safeNext = sanitizeNextPath(next, "/dashboard");
  return `/onboarding?next=${encodeURIComponent(safeNext)}`;
}

export function entryLoginRedirectTo(next?: string): string {
  const safeNext = sanitizeNextPath(next, "/entry");
  return onboardingHref(safeNext);
}

/** writeGuard の deny reason からオンボーディング導線 URL を返す。該当なしは null。 */
export function getOnboardingHrefForWriteGuardReason(
  reason: WriteGuardDenyReason,
  next?: string,
): string | null {
  const safeNext = sanitizeNextPath(next ?? "/dashboard");
  switch (reason) {
    case "unauthenticated":
      return `/entry?next=${encodeURIComponent(safeNext)}`;
    case "tos_required":
    case "tos_reaccept_required":
      return onboardingRulesHref(onboardingHref(safeNext));
    case "active_x_required":
    case "active_x_rejected":
    case "active_x_not_approved":
      return onboardingHref(safeNext);
    default:
      return null;
  }
}
