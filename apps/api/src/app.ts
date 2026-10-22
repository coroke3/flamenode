import { Hono } from "hono";
import type { AppEnv } from "./env.ts";
import { healthRoutes } from "./routes/health.ts";
import { publicAboutStatsRoutes } from "./routes/publicAboutStats.ts";
import { softwareSuggestionsRoutes } from "./routes/softwareSuggestions.ts";
import { createAdminRoutes } from "./routes/admin/index.ts";
import { videosRoutes } from "./routes/videos/index.ts";

export const app = new Hono<AppEnv>();

// URL + method match CURRENT app/api/** (FILE_MIGRATION_MATRIX RH-017/018/026/029).
app.route("/api/health", healthRoutes);
app.route("/api/public/about-stats", publicAboutStatsRoutes);
app.route("/api/software/suggestions", softwareSuggestionsRoutes);
app.route("/api/admin", createAdminRoutes());
app.route("/api/videos", videosRoutes);
