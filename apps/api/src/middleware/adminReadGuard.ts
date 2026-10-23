/**
 * MIG-0602: default read guard for GET/HEAD under /api/admin, so any future
 * admin read is protected unless it deliberately sits outside this router.
 * Mirrors CURRENT src/lib/auth/routeGuard.ts requireRouteUser({ requiredRole:
 * "admin" }) as used by requireAdminSpreadsheetApi:
 *   session unavailable -> 503 { error: "database_unavailable" }
 *   no user             -> 401 { error: "unauthorized" }
 *   banned              -> 403 { error: "account_disabled" }
 *   not admin           -> 403 { error: "forbidden" }
 * Every response is private, no-store. No TOS / CostGuard (CURRENT reads
 * do not check them); no extra D1 read beyond session resolution.
 */
import type { Context, Next } from "hono";
import type { SessionUser } from "../auth/session.ts";
import { SESSION_UNAVAILABLE_CODE } from "../auth/session.ts";

function deny(c: Context, error: string, status: 401 | 403 | 503): Response {
  c.header("Content-Type", "application/json");
  c.header("Cache-Control", "private, no-store");
  return c.body(JSON.stringify({ error }), status);
}

export function adminReadGuardMiddleware() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (c.get("sessionState") === "unavailable") {
      return deny(c, SESSION_UNAVAILABLE_CODE, 503);
    }
    const user = c.get("user") as SessionUser | null;
    if (!user) return deny(c, "unauthorized", 401);
    if (user.is_banned === 1) return deny(c, "account_disabled", 403);
    if (user.role !== "admin") return deny(c, "forbidden", 403);
    await next();
  };
}

/** Run `middleware` only for GET/HEAD (safe reads); OPTIONS is left alone. */
export function onlyReads(
  middleware: (c: Context, next: Next) => Promise<Response | void>,
): (c: Context, next: Next) => Promise<Response | void> {
  return (c, next) => {
    const method = c.req.method.toUpperCase();
    return method === "GET" || method === "HEAD" ? middleware(c, next) : next();
  };
}
