import { Hono } from "hono";
import type { AdminReadError } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { requireAuth, sessionMiddleware } from "../../auth/session.ts";
import { adminEventNewRoutes, adminEventTemplatesRoutes } from "./eventTemplates.ts";
import { adminEventsRoutes } from "./events.ts";
import { adminModerationRoutes } from "./moderation.ts";
import { adminUsersRoutes } from "./users.ts";
import { adminXIdMergesRoutes } from "./xIdMerges.ts";
import { adminXLinkRequestsRoutes } from "./xLinkRequests.ts";
import { adminVideosRoutes } from "./videos.ts";

// MIG-0625: read-only Admin screens API (users / videos / events / moderation). GET only; nothing here writes.
// Mounted at /api/admin-read so it never shares a path prefix with the mutating /api/admin write guard.
// Every response (success, 401, 403, 503) is `Cache-Control: private, no-store`.
const NO_STORE = "private, no-store";

export const adminReadRoutes = new Hono<AppEnv>();

adminReadRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", NO_STORE);
});
adminReadRoutes.use("*", sessionMiddleware());
// 401 (no/expired session -> SPA /entry) and 403 (banned), exactly like CURRENT getLayoutAuthSurface + banned handling.
adminReadRoutes.use("*", requireAuth());
// CURRENT app/(admin)/layout.tsx: `headerUser.role !== "admin"` -> redirect("/dashboard"). Moderators are NOT admins here.
adminReadRoutes.use("*", async (c, next) => {
  if (c.get("user")?.role !== "admin") {
    const body: AdminReadError = { error: "Forbidden", redirect: "/dashboard" };
    return c.json(body, 403);
  }
  await next();
});

adminReadRoutes.route("/users", adminUsersRoutes);
adminReadRoutes.route("/videos", adminVideosRoutes);
adminReadRoutes.route("/events/templates", adminEventTemplatesRoutes);
adminReadRoutes.route("/events/new", adminEventNewRoutes);
adminReadRoutes.route("/events", adminEventsRoutes);
adminReadRoutes.route("/moderation", adminModerationRoutes);
adminReadRoutes.route("/x-link-requests", adminXLinkRequestsRoutes);
adminReadRoutes.route("/x-id-merges", adminXIdMergesRoutes);

// D1 failures: fixed code only (errors may carry bound values); CURRENT pages without a try/catch show the error page.
adminReadRoutes.onError((_error, c) => {
  console.error("[adminRead] READ_FAILED");
  const body: AdminReadError = { error: "unavailable" };
  return c.json(body, 503, { "Cache-Control": NO_STORE });
});
