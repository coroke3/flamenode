import { sanitizeNextPath } from "#utils/next";export interface GuardRouter {
  push(path: string): void;
}

function sanitizeCurrentPath(currentPath: string | null | undefined): string {
  return sanitizeNextPath(currentPath, "/");
}

export function getGuardRedirectPath(
  reason: string | null | undefined,
  currentPath: string | null | undefined,
): string | null {
  const safeNext = encodeURIComponent(sanitizeCurrentPath(currentPath));
  switch (reason) {
    case "unauthenticated":
      return `/entry?next=${safeNext}`;
    case "tos_required":
    case "tos_reaccept_required":
      return `/rules?next=${safeNext}`;
    case "active_x_required":
    case "active_x_rejected":
    case "active_x_not_approved":
      return `/dashboard/settings?next=${safeNext}`;
    default:
      return null;
  }
}

export function shouldShowGuardErrorOnly(
  reason: string | null | undefined,
): boolean {
  return (
    reason === "banned" ||
    reason === "maintenance_mode" ||
    reason === "cost_guard_blocked" ||
    reason === "db_unavailable"
  );
}

export function redirectForGuardReason(
  router: GuardRouter,
  reason: string | null | undefined,
  currentPath: string | null | undefined,
): boolean {
  const path = getGuardRedirectPath(reason, currentPath);
  if (!path) return false;
  router.push(path);
  return true;
}
