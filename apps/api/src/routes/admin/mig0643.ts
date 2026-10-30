/**
 * MIG-0643: one explicit registration point for all seven admin operations.
 *
 * The actual app admin/index.ts is owned by MIG-0637 PR #472. Once that owner
 * releases the file, call mountMig0643AdminRoutes(admin) inside
 * createAdminRoutes() AFTER origin -> session -> writeGuard -> db middleware,
 * BEFORE returning admin. Never mount these as siblings directly on app.ts:
 * sibling routes do NOT inherit the private admin router's middleware.
 *
 * The production parent does not import or call this module yet; this file
 * is exercised in the isolated integration test until the dependency merges.
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
