import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { requireAuth, sessionMiddleware } from "../../auth/session.ts";
import { manageDashboardRoutes } from "./dashboard.ts";
import { manageAudienceRoutes } from "./audience.ts";
import { manageEventEditRoutes } from "./eventEdit.ts";
import { manageNavigationRoutes } from "./navigation.ts";
import { managePlaylistRoutes } from "./playlist.ts";
import { playlistWriteRoutes } from "./playlistWrite.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import { originGuardMiddleware, onlyMutating, writeGuardMiddleware } from "../../middleware/writeOrigin.ts";
import { manageVideoDetailRoutes } from "./videoDetail.ts";
import { manageVideosRoutes } from "./videos.ts";
import { manageNotificationCenterRoutes } from "./notificationCenter.ts";
import { manageOverviewRoutes } from "./overview.ts";
import { manageSlotsRoutes } from "./slots.ts";
import { manageStaffRoutes } from "./staff.ts";
import { registerStaffWriteRoutes } from "./staffWrite.ts";
import { manageXLinkRequestRoutes } from "./xlink.ts";

// MIG-0624: authenticated, read-only Manage screens API. Every response (success, 401, 403, 404, 503)
// is `Cache-Control: private, no-store`. GET does not write; writes (MIG-0655 playlist and MIG-0654 staff mutations)
// go through the onlyMutating Origin -> session -> writeGuard -> db stack below (D-15-10).
// Status mapping of CURRENT redirects/notFound: not logged in -> 401, banned -> 403 (requireAuth),
// neither admin nor event staff (layout redirect to /dashboard) -> 403 { reason: "manage_access_required" },
// notFound() -> 404.
const NO_STORE = "private, no-store";

export const manageRoutes = new Hono<AppEnv>();

manageRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", NO_STORE);
});
// MIG-0655: playlist writes verify Origin BEFORE reading the Auth.js session.
const playlistWritePaths = ["/events/:id/youtube-playlist", "/events/:id/youtube-playlist/sync"];
const staffWritePaths = ["/events/:id/staff", "/events/:id/staff/:staffId"];
const guardedWritePaths = [...playlistWritePaths, ...staffWritePaths];
const originOptions = (c: import("hono").Context<AppEnv>) => ({
  loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
  allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
});
for (const path of guardedWritePaths) {
  manageRoutes.use(path, onlyMutating((c, next) => originGuardMiddleware(originOptions(c))(c, next)));
}
manageRoutes.use("*", sessionMiddleware());
manageRoutes.use("*", requireAuth());
// The existing read-only /manage API remains unchanged. Every mutating
// playlist AND staff path must receive writeGuard(identity/TOS) -> DB before
// the handlers; onlyMutating keeps the GET staff endpoint read-only.
for (const path of guardedWritePaths) {
  manageRoutes.use(path, onlyMutating((c, next) =>
    writeGuardMiddleware({ ...originOptions(c), requiredRole: null })(c, next)));
  manageRoutes.use(path, onlyMutating(dbMiddleware));
}

manageRoutes.route("/navigation", manageNavigationRoutes);
manageRoutes.route("/events/:id/staff", manageStaffRoutes);
registerStaffWriteRoutes(manageRoutes);
manageRoutes.route("/events/:id/slots", manageSlotsRoutes);
manageRoutes.route("/events/:id/edit", manageEventEditRoutes);
manageRoutes.route("/events/:id/videos/:videoId", manageVideoDetailRoutes);
manageRoutes.route("/events/:id/videos", manageVideosRoutes);
manageRoutes.route("/events/:id/youtube-playlist", managePlaylistRoutes);
manageRoutes.route("/events/:id/youtube-playlist", playlistWriteRoutes);
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
