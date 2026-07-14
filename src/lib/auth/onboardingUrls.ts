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