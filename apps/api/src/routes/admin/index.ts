/**
 * MIG-0602: admin mutation routes. Every route under /api/admin is mounted
 * behind, in this order (contract-tested):
 *   1. session middleware (tri-state, C-1)
 *   2. writeGuardMiddleware (origin -> auth -> identity)
 *   3. costGuardMiddleware (per feature, inside each route module)
 */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { sessionMiddleware } from "../../auth/session.ts";
import type { AppEnv } from "../../env.ts";
import { writeGuardMiddleware } from "../../middleware/writeOrigin.ts";
import { announcementRoutes } from "./announcements.ts";
import { apiEndpointRoutes } from "./apiEndpoints.ts";

export function createAdminRoutes(
  options: { session?: MiddlewareHandler<AppEnv> } = {},
): Hono<AppEnv> {
  const admin = new Hono<AppEnv>();
  admin.use(
    "*",
    options.session ??
      (sessionMiddleware() as unknown as MiddlewareHandler<AppEnv>),
  );
  admin.use("*", (c, next) =>
    writeGuardMiddleware({
      loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
      // Never derived from NODE_ENV: only the explicit preview flag.
      allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
    })(c, next),
  );
  admin.route("/announcements", announcementRoutes);
  admin.route("/api-endpoints", apiEndpointRoutes);
  return admin;
}
