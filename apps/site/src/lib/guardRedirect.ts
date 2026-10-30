import { sanitizeNextPath } from "../../../../src/lib/utils/next.ts";

/**
 * CURRENT src/lib/client/guardRedirect.ts parity for public Astro Islands.
 * Browser navigation is supplied by the caller; no Next router dependency.
 */
export function getGuardRedirectPath(
  reason: string | null | undefined,
  currentPath: string | null | undefined,
): string | null {
  const safeNext = encodeURIComponent(sanitizeNextPath(currentPath, "/"));
  switch (reason) {
    case "unauthenticated":
      return `/entry?next=${safeNext}`;
    case "tos_required":
    case "tos_reaccept_required":
    case "active_x_required":
    case "active_x_rejected":
    case "active_x_not_approved":
      return `/onboarding?next=${safeNext}`;
    default:
      return null;
  }
}

export function shouldShowGuardErrorOnly(reason: string | null | undefined): boolean {
  return reason === "banned" ||
    reason === "maintenance_mode" ||
    reason === "cost_guard_blocked" ||
    reason === "db_unavailable";
}

export function redirectForGuardReason(
  navigate: (path: string) => void,
  reason: string | null | undefined,
  currentPath: string | null | undefined,
): boolean {
  const path = getGuardRedirectPath(reason, currentPath);
  if (!path) return false;
  navigate(path);
  return true;
}
