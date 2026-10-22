import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { requireAuth, sessionMiddleware } from "../../auth/session.ts";
import { manageDashboardRoutes } from "./dashboard.ts";
import { manageAudienceRoutes } from "./audience.ts";
import { manageNavigationRoutes } from "./navigation.ts";
import { managePlaylistRoutes } from "./playlist.ts";
import { manageVideoDetailRoutes } from "./videoDetail.ts";
import { manageVideosRoutes } from "./videos.ts";
import { manageNotificationCenterRoutes } from "./notificationCenter.ts";
import { manageOverviewRoutes } from "./overview.ts";
import { manageSlotsRoutes } from "./slots.ts";
import { manageStaffRoutes } from "./staff.ts";
import { manageXLinkRequestRoutes } from "./xlink.ts";

// MIG-0624: authenticated, read-only Manage screens API. Every response (success, 401, 403, 404, 503)
// is `Cache-Control: private, no-store`; nothing here writes to D1, R2, KV or cookies.
// Status mapping of CURRENT redirects/notFound: not logged in -> 401, banned -> 403 (requireAuth),
// neither admin nor event staff (layout redirect to /dashboard) -> 403 { reason: "manage_access_required" },
// notFound() -> 404.
const NO_STORE = "private, no-store";

export const manageRoutes = new Hono<AppEnv>();

manageRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", NO_STORE);
});
manageRoutes.use("*", sessionMiddleware());
manageRoutes.use("*", requireAuth());

manageRoutes.route("/navigation", manageNavigationRoutes);
manageRoutes.route("/events/:id/staff", manageStaffRoutes);
manageRoutes.route("/events/:id/slots", manageSlotsRoutes);
manageRoutes.route("/events/:id/videos/:videoId", manageVideoDetailRoutes);
manageRoutes.route("/events/:id/videos", manageVideosRoutes);
manageRoutes.route("/events/:id/youtube-playlist", managePlaylistRoutes);
manageRoutes.route("/events/:id/audience", manageAudienceRoutes);
manageRoutes.route("/events/:id", manageOverviewRoutes);
manageRoutes.route("/notifications", manageNotificationCenterRoutes);
manageRoutes.route("/x-link-requests", manageXLinkRequestRoutes);
manageRoutes.route("/", manageDashboardRoutes);

// D1 failures: fixed code only (errors may carry bound values); the SPA shows its "unavailable" state.
manageRoutes.onError((_error, c) => {
  console.error("[manage] READ_FAILED");
  return c.json({ error: "unavailable" }, 503, { "Cache-Control": NO_STORE });
});
