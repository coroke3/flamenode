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
import { manageXLinkRequestRoutes } from "./xlink.ts";

// MIG-0624: authenticated, read-only Manage screens API. Every response (success, 401, 403, 404, 503)
// is `Cache-Control: private, no-store`. GET does not write. Scoped playlist writes
// and PREPARED (still unmounted) slot writes use onlyMutating Origin -> session
// -> writeGuard -> db stack in D-15-10 order.
// Status mapping of CURRENT redirects/notFound: not logged in -> 401, banned -> 403 (requireAuth),
// neither admin nor event staff (layout redirect to /dashboard) -> 403 { reason: "manage_access_required" },
// notFound() -> 404.
const NO_STORE = "private, no-store";

export const manageRoutes = new Hono<AppEnv>();

manageRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", NO_STORE);
});
// D-15-10: only predeclared write paths verify Origin BEFORE the Auth.js session.
// SA-060/062/063/064 remain UNMOUNTED; middleware entries are preparation only.
const playlistWritePaths = ["/events/:id/youtube-playlist", "/events/:id/youtube-playlist/sync"];
const slotWritePaths = ["/events/:id/slots/batch-delete", "/events/:id/slots/batch-release", "/events/:id/slots/labels", "/events/:id/slots/:slotId/release"];
// SA-056/057 are prepared for the same Origin-first / session / writeGuard / DB
// stack. The submitted-danger Hono candidate remains deliberately UNMOUNTED.
const submittedDangerWritePaths = [
  "/events/:id/slots/:slotId/force-release-submitted",
  "/events/:id/slots/:slotId/release-submitted-video",
];
const scopedWritePaths = [...playlistWritePaths, ...slotWritePaths, ...submittedDangerWritePaths];
// Dynamic :slotId path overlaps /batch-delete etc. Apply ONLY to DELETE.
const singleSlotDeletePath = "/events/:id/slots/:slotId";
const originOptions = (c: import("hono").Context<AppEnv>) => ({
  loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
  allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
});
for (const path of scopedWritePaths) {
  manageRoutes.use(path, onlyMutating((c, next) => originGuardMiddleware(originOptions(c))(c, next)));
}
manageRoutes.use(singleSlotDeletePath, (c, next) =>
  c.req.method === "DELETE" ? originGuardMiddleware(originOptions(c))(c, next) : next());
manageRoutes.use("*", sessionMiddleware());
manageRoutes.use("*", requireAuth());
// The existing read-only /manage API remains unchanged. Only explicit mutating
// paths use the CURRENT writeGuard(identity/TOS) -> DB adapter. Slot routes
// are not mounted until full independent review and D1/browser parity.
for (const path of scopedWritePaths) {
  manageRoutes.use(path, onlyMutating((c, next) =>
    writeGuardMiddleware({ ...originOptions(c), requiredRole: null })(c, next)));
  manageRoutes.use(path, onlyMutating(dbMiddleware));
}

// SA-061 unmounted candidate: no double guards on POST/PATCH batch endpoints.
manageRoutes.use(singleSlotDeletePath, (c, next) =>
  c.req.method === "DELETE"
    ? writeGuardMiddleware({ ...originOptions(c), requiredRole: null })(c, next)
    : next());
manageRoutes.use(singleSlotDeletePath, (c, next) =>
  c.req.method === "DELETE" ? dbMiddleware(c, next) : next());

manageRoutes.route("/navigation", manageNavigationRoutes);
manageRoutes.route("/events/:id/staff", manageStaffRoutes);
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
