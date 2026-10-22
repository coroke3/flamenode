/**
 * MIG-0602: admin mutation routes. Every NON-GET/HEAD/OPTIONS request under
 * /api/admin is checked, in this order (contract-tested):
 *   1. origin (pure, before any D1 read)
 *   2. session middleware (tri-state, C-1)
 *   3. writeGuardMiddleware (origin -> auth -> identity)
 *   4. costGuardMiddleware (per feature, inside each route module)
 * GET reads (e.g. future spreadsheet reads) are not blocked by these
 * write-only checks; they mount their own read guard.
 */
import { Hono, type Context } from "hono";
import type { MiddlewareHandler } from "hono";
import { sessionMiddleware } from "../../auth/session.ts";
import type { AppEnv } from "../../env.ts";
import {
  onlyMutating,
  originGuardMiddleware,
  writeGuardMiddleware,
} from "../../middleware/writeOrigin.ts";
import { announcementRoutes } from "./announcements.ts";
import { apiEndpointRoutes } from "./apiEndpoints.ts";

export function createAdminRoutes(
  options: { session?: MiddlewareHandler<AppEnv> } = {},
): Hono<AppEnv> {
  const admin = new Hono<AppEnv>();
  const originOptions = (c: Context<AppEnv>) => ({
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
    // Never derived from NODE_ENV: only the explicit preview flag.
    allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
  });
  // 1. origin first (pure, no D1): a cross-origin request never costs a read.
  admin.use("*", onlyMutating((c, next) => originGuardMiddleware(originOptions(c))(c, next)));
  // 2. session (tri-state)
  admin.use(
    "*",
    options.session ??
      (sessionMiddleware() as unknown as MiddlewareHandler<AppEnv>),
  );
  // 3. origin (repeated, pure) -> auth -> identity
  admin.use("*", onlyMutating((c, next) => writeGuardMiddleware(originOptions(c))(c, next)));
  // 4. CostGuard is mounted per feature inside each route module.
  admin.route("/announcements", announcementRoutes);
  admin.route("/api-endpoints", apiEndpointRoutes);
  return admin;
}
