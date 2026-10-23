import { Hono } from "hono";
import type { AppEnv } from "./env.ts";
import { healthRoutes } from "./routes/health.ts";
import { personalRoutes } from "./routes/personal/index.ts";
import { publicAboutStatsRoutes } from "./routes/publicAboutStats.ts";
import { softwareSuggestionsRoutes } from "./routes/softwareSuggestions.ts";
import { createAdminRoutes } from "./routes/admin/index.ts";
import { videosRoutes } from "./routes/videos/index.ts";
import { accountSummaryRoutes } from "./routes/account/summary.ts";
import { googleDriveImageRoutes, youtubeThumbnailRoutes } from "./routes/media/proxies.ts";

export const app = new Hono<AppEnv>();

// URL + method match CURRENT app/api/** (FILE_MIGRATION_MATRIX RH-017/018/026/029).
app.route("/api/health", healthRoutes);
app.route("/api/public/about-stats", publicAboutStatsRoutes);
app.route("/api/software/suggestions", softwareSuggestionsRoutes);
// MIG-0611: authenticated read-only Personal screens API (no CURRENT /api/* equivalent).
app.route("/api/personal", personalRoutes);
app.route("/api/admin", createAdminRoutes());
app.route("/api/videos", videosRoutes);
// MIG-0605 U01 (RH-001): GET /api/account/summary
app.route("/api/account/summary", accountSummaryRoutes);
// MIG-0605 U03 (part): RH-016, RH-033
app.route("/api/google-drive-image", googleDriveImageRoutes);
app.route("/api/youtube-thumbnail", youtubeThumbnailRoutes);
