/**
 * MIG-0643: one explicit registration point for all seven admin operations.
 *
 * The production parent admin/index.ts now calls mountMig0643AdminRoutes()
 * inside createAdminRoutes(), after origin -> session -> writeGuard -> db.
 * Never mount these handlers directly on app.ts: sibling routes would not
 * inherit the private admin router's middleware.
 *
 * This integration exists only on the migration PR branch until reviewed
 * squash merge. It is not deployed or available on production routes.
 */
import type { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { staticBackfillAdminRoutes } from "./staticBackfill.ts";
import { staticRebuildAdminRoutes } from "./staticRebuild.ts";
import { visibilityRepairAdminRoutes } from "./visibilityRepair.ts";
import { youtubeSyncAdminRoutes } from "./youtubeSync.ts";

export function mountMig0643AdminRoutes(admin: Hono<AppEnv>): void {
  admin.route("/static-builds/backfill", staticBackfillAdminRoutes);
  admin.route("/static-builds", staticRebuildAdminRoutes);
  admin.route("/visibility-repair", visibilityRepairAdminRoutes);
  admin.route("/youtube-sync", youtubeSyncAdminRoutes);
}
