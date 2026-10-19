import { Hono } from "hono";
import type { AppEnv } from "./env.ts";
import { healthRoutes } from "./routes/health.ts";
import { publicAboutStatsRoutes } from "./routes/publicAboutStats.ts";
import { softwareSuggestionsRoutes } from "./routes/softwareSuggestions.ts";

export const app = new Hono<AppEnv>();

// Register routes
app.route("/api/health", healthRoutes);
app.route("/api/public/about-stats", publicAboutStatsRoutes);
app.route("/api/software/suggestions", softwareSuggestionsRoutes);

// Fallback without /api prefix for health probe compatibility
app.route("/health", healthRoutes);
