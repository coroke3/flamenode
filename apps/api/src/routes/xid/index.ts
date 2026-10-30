/**
 * MIG-0636 Personal X writes. Order matches CURRENT:
 * origin -> Auth.js session -> banned/terms -> CostGuard -> mutation.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { sessionMiddleware } from "../../auth/session.ts";
import type { AppEnv } from "../../env.ts";
import {
  originGuardMiddleware,
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
  // Only the mounted POST /active write needs Origin and session resolution.
  // Unknown paths and non-mutating methods must retain Hono's 404/405
  // behavior without consulting D1 or requiring an Origin header.
  xid.use("/active", (c, next) =>
    c.req.method === "POST" ? originGuardMiddleware(originOptions(c))(c, next) : next(),
  );
  xid.use("/active", (c, next) =>
    c.req.method === "POST" ? (options.session ?? sessionMiddleware())(c, next) : next(),
  );
  // SA-098 shares its one D1 read between TOS, user CAS snapshot and
  // selected linked-X access. Its route performs the remaining identity,
  // CostGuard, strict audit, and Drizzle checks in CURRENT order.
  xid.route("/active", activeXRoutes);
  return xid;
}

export const xidRoutes = createXidRoutes();
