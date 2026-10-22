import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { requireAuth, sessionMiddleware } from "../../auth/session.ts";
import { adminAuditRoutes } from "./audit.ts";
import { adminOpsRoutes } from "./ops.ts";
import { adminSettingsRoutes } from "./settings.ts";

// MIG-0626 (with MIG-0625): authenticated, admin-only, read-only Admin screens API.
// Mounted at /api/admin-read, deliberately NOT under /api/admin: the MIG-0602 admin router only guards
// non-GET/HEAD/OPTIONS requests and has no default read guard. Every response (success, 401, 403, 503) is
// "Cache-Control: private, no-store"; nothing here writes to D1, R2, KV or cookies.
const NO_STORE = "private, no-store";

export const adminReadRoutes = new Hono<AppEnv>();

adminReadRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", NO_STORE);
});
adminReadRoutes.use("*", sessionMiddleware());
adminReadRoutes.use("*", requireAuth());
// CURRENT app/(admin)/layout.tsx: role !== "admin" redirects away. Several pages also notFound() for non-admins;
// both mean "not allowed" and are expressed here as a single 403.
adminReadRoutes.use("*", async (c, next) => {
  const user = c.get("user");
  // Same body as the part-A router (PR #349) so both mounts of one shared router agree.
  if (!user || user.role !== "admin") return c.json({ error: "Forbidden", redirect: "/dashboard" }, 403);
  await next();
});

adminReadRoutes.route("/", adminSettingsRoutes);
adminReadRoutes.route("/audit", adminAuditRoutes);
adminReadRoutes.route("/ops", adminOpsRoutes);

// D1 failures: fixed code only (errors may carry bound values); the SPA shows its "unavailable" state.
adminReadRoutes.onError((_error, c) => {
  console.error("[adminRead] READ_FAILED");
  return c.json({ error: "unavailable" }, 503, { "Cache-Control": NO_STORE });
});
