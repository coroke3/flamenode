/**
 * MIG-0636 Personal X writes. Order matches CURRENT:
 * origin -> Auth.js session -> banned/terms -> CostGuard -> mutation.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { sessionMiddleware } from "../../auth/session.ts";
import type { AppEnv } from "../../env.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import {
  originGuardMiddleware,
  writeGuardMiddleware,
} from "../../middleware/writeOrigin.ts";
import { activeXRoutes } from "./activeX.ts";

export function createXidRoutes(
  options: { session?: MiddlewareHandler<AppEnv> } = {},
): Hono<AppEnv> {
  const xid = new Hono<AppEnv>();
  const originOptions = (c: Context<AppEnv>) => ({
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
    allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
  });
  xid.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  xid.use("*", (c, next) => originGuardMiddleware(originOptions(c))(c, next));
  xid.use("*", options.session ?? sessionMiddleware());
  xid.use("*", (c, next) =>
    writeGuardMiddleware({ ...originOptions(c), requiredRole: null })(c, next));
  xid.use("*", costGuardMiddleware("xid_links"));
  xid.use("*", dbMiddleware);
  xid.route("/active", activeXRoutes);
  return xid;
}

export const xidRoutes = createXidRoutes();
