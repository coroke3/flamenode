import { Hono } from "hono";
import type { AppEnv } from "./env.ts";
import { adminReadRoutes } from "./routes/adminRead/index.ts";
import { healthRoutes } from "./routes/health.ts";
import { personalRoutes } from "./routes/personal/index.ts";
import { manageRoutes } from "./routes/manage/index.ts";
import { publicAboutStatsRoutes } from "./routes/publicAboutStats.ts";
import { softwareSuggestionsRoutes } from "./routes/softwareSuggestions.ts";
import { createAdminRoutes } from "./routes/admin/index.ts";
import { liveEventRoutes } from "./routes/live/events.ts";
import { adminEventRoutes } from "./routes/events/index.ts";
import { slotViewerOverlayRoutes } from "./routes/events/viewerOverlay.ts";
import { videosRoutes } from "./routes/videos/index.ts";
import { accountSummaryRoutes } from "./routes/account/summary.ts";
import { googleDriveImageRoutes, youtubeThumbnailRoutes } from "./routes/media/proxies.ts";

import { createSpreadsheetReadRoutes } from "./routes/admin/spreadsheet/read.ts";

export const app = new Hono<AppEnv>();

// URL + method match CURRENT app/api/** (FILE_MIGRATION_MATRIX RH-017/018/026/029).
app.route("/api/health", healthRoutes);
app.route("/api/public/about-stats", publicAboutStatsRoutes);
app.route("/api/software/suggestions", softwareSuggestionsRoutes);
// MIG-0611: authenticated read-only Personal screens API (no CURRENT /api/* equivalent).
app.route("/api/personal", personalRoutes);
// MIG-0625: authenticated, admin-only, read-only Admin screens API (users / videos / events / moderation).
app.route("/api/admin-read", adminReadRoutes);
app.route("/api/manage", manageRoutes);
// MIG-0605 U02 (RH-003/007/009 reads): BEFORE createAdminRoutes() so the disabled flag answers before any session read.
app.route("/api/admin/spreadsheet", createSpreadsheetReadRoutes());
app.route("/api/admin", createAdminRoutes());
// Must stay after createAdminRoutes(): reuses its session + writeGuard middleware.
app.route("/api/admin", adminEventRoutes);
app.route("/api/live/events", liveEventRoutes);
// MIG-0604 U01 (RH-014): GET /api/events/:id/slots/viewer-overlay
app.route("/api/events", slotViewerOverlayRoutes);
app.route("/api/videos", videosRoutes);
// MIG-0605 U01 (RH-001): GET /api/account/summary
app.route("/api/account/summary", accountSummaryRoutes);
// MIG-0605 U03 (part): RH-016, RH-033
app.route("/api/google-drive-image", googleDriveImageRoutes);
app.route("/api/youtube-thumbnail", youtubeThumbnailRoutes);
