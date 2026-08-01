import { sanitizeAuthCompleteNext } from "./authComplete";
import { entryLoginRedirectTo as authCompleteEntryLoginRedirectTo } from "./authComplete";

/**
 * オンボーディング・規約まわりの `next` を検証する。
 * `/auth/complete` と同じ拒否集合で循環・callback・規約/オンボーディング自身を防ぐ。
 */
export function sanitizeOnboardingNext(
  next?: string | null,
  fallback = "/dashboard",
): string {
  return sanitizeAuthCompleteNext(next, fallback);
}

export function onboardingRulesHref(next: string): string {
  const safeNext = sanitizeOnboardingNext(next, "/dashboard");
  return `/rules?next=${encodeURIComponent(safeNext)}`;
}

export function onboardingHref(next?: string): string {
  const safeNext = sanitizeOnboardingNext(next, "/dashboard");
  return `/onboarding?next=${encodeURIComponent(safeNext)}`;
}

/** Discord signIn 後は軽量 /auth/complete を経由する。 */
export function entryLoginRedirectTo(next?: string): string {
  return authCompleteEntryLoginRedirectTo(next);
}
