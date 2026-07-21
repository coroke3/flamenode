import "server-only";

import {
  CurrentUserUnavailableError,
  getCurrentUser,
  type CurrentUser,
} from "./currentUser";

export type RouteUserGuardResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; status: 401 | 403 | 503; error: string };

export async function requireRouteUser(options: {
  requiredRole?: "admin";
} = {}): Promise<RouteUserGuardResult> {
  let user: CurrentUser | null;
  try {
    user = await getCurrentUser();
  } catch (error) {
    if (error instanceof CurrentUserUnavailableError) {
      return { ok: false, status: 503, error: error.code };
    }
    throw error;
  }

  if (!user) return { ok: false, status: 401, error: "unauthorized" };
  if (user.is_banned === 1) {
    return { ok: false, status: 403, error: "account_disabled" };
  }
  if (options.requiredRole === "admin" && user.role !== "admin") {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, user };
}
