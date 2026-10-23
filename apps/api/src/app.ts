import { Hono } from "hono";
import type { AppEnv } from "./env.ts";
import { healthRoutes } from "./routes/health.ts";
import { personalRoutes } from "./routes/personal/index.ts";
import { publicAboutStatsRoutes } from "./routes/publicAboutStats.ts";
import { softwareSuggestionsRoutes } from "./routes/softwareSuggestions.ts";
import { createAdminRoutes } from "./routes/admin/index.ts";
import { liveEventRoutes } from "./routes/live/events.ts";
import { adminEventRoutes } from "./routes/events/index.ts";

export const app = new Hono<AppEnv>();

// URL + method match CURRENT app/api/** (FILE_MIGRATION_MATRIX RH-017/018/026/029).
app.route("/api/health", healthRoutes);
app.route("/api/public/about-stats", publicAboutStatsRoutes);
app.route("/api/software/suggestions", softwareSuggestionsRoutes);
// MIG-0611: authenticated read-only Personal screens API (no CURRENT /api/* equivalent).
app.route("/api/personal", personalRoutes);
app.route("/api/admin", createAdminRoutes());
// Must stay after createAdminRoutes(): reuses its session + writeGuard middleware.
app.route("/api/admin", adminEventRoutes);
app.route("/api/live/events", liveEventRoutes);
