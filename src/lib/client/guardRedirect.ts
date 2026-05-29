export type GuardRedirectReason =
  | "unauthenticated"
  | "db_unavailable"
  | "banned"
  | "tos_required"
  | "tos_reaccept_required"
  | "maintenance_mode"
  | "cost_guard_blocked"
  | "active_x_required"
  | "active_x_rejected"
  | "active_x_not_approved";

export interface GuardRouter {
  push(path: string): void;
}

const SETTINGS_REASONS = new Set<GuardRedirectReason>([
  "active_x_required",
  "active_x_rejected",
  "active_x_not_approved",
]);

function sanitizeCurrentPath(currentPath: string | null | undefined): string {
  const raw = typeof currentPath === "string" ? currentPath.trim() : "";
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
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

export function isSettingsGuardReason(
  reason: string | null | undefined,
): reason is GuardRedirectReason {
  return SETTINGS_REASONS.has(reason as GuardRedirectReason);
}
