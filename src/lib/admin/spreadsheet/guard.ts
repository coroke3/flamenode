import "server-only";
import { CurrentUserUnavailableError } from "@/lib/auth/currentUser";
import { requireRouteUser } from "@/lib/auth/routeGuard";
import {
  requireAdminWrite,
  type WriteGuardDenyReason,
  type WriteGuardResult,
} from "@/lib/auth/writeGuard";

export function isAdminSpreadsheetEnabled(): boolean {
  const v = process.env.ADMIN_SPREADSHEET_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export interface AdminSpreadsheetSession {
  userId: string;
}

export type AdminSpreadsheetGuardResult =
  | { ok: true; session: AdminSpreadsheetSession }
  | { ok: false; status: 401 | 403 | 404 | 503; error: string };

function writeGuardHttpStatus(
  reason: WriteGuardDenyReason,
): 401 | 403 | 503 {
  if (reason === "unauthenticated") return 401;
  if (
    reason === "db_unavailable" ||
    reason === "maintenance_mode" ||
    reason === "cost_guard_blocked"
  ) {
    return 503;
  }
  return 403;
}

export async function requireAdminSpreadsheetApi(): Promise<
  AdminSpreadsheetGuardResult
> {
  if (!isAdminSpreadsheetEnabled()) {
    return { ok: false, status: 404, error: "spreadsheet_disabled" };
  }
  const guard = await requireRouteUser({ requiredRole: "admin" });
  if (!guard.ok) return guard;
  return { ok: true, session: { userId: guard.user.id } };
}

/**
 * 管理スプレッドシートの副作用を伴う操作専用ガード。
 * BAN / TOS / 規約再同意 / CostGuard / admin 権限を共通判定する。
 */
export async function requireAdminSpreadsheetWriteApi(): Promise<
  AdminSpreadsheetGuardResult
> {
  if (!isAdminSpreadsheetEnabled()) {
    return { ok: false, status: 404, error: "spreadsheet_disabled" };
  }

  let guard: WriteGuardResult;
  try {
    guard = await requireAdminWrite("admin_spreadsheet");
  } catch (error) {
    if (error instanceof CurrentUserUnavailableError) {
      return { ok: false, status: 503, error: error.code };
    }
    throw error;
  }

  if (!guard.ok) {
    return {
      ok: false,
      status: writeGuardHttpStatus(guard.reason),
      error: guard.reason,
    };
  }
  return { ok: true, session: { userId: guard.user.id } };
}
