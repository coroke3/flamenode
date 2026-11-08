/**
 * MIG-0659 (D-15-8): /api/xid router. MIG-0636 (Personal X / Active X APIs) shares this file; whichever
 * merges first creates it and the other adds its own `route(...)` line.
 *
 * Write stack (same order as videoWriteStack / the admin routes): no-store header, origin (pure, before any
 * D1 read), session, writeGuard (any role, identity only), CostGuard `xid_links`, drizzle handle.
 */
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { sessionMiddleware } from "../../auth/session.ts";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../../middleware/writeOrigin.ts";
import { createXIdRequestRoutes } from "./requests.ts";

export function xidWriteStack(session?: MiddlewareHandler<AppEnv>): MiddlewareHandler<AppEnv> {
  const originOptions = (c: Context<AppEnv>) => ({
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
    // Never derived from NODE_ENV: only the explicit preview flag.
    allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
  });
  const stack: MiddlewareHandler<AppEnv>[] = [
    (c, next) => originGuardMiddleware(originOptions(c))(c, next),
    session ?? (sessionMiddleware() as unknown as MiddlewareHandler<AppEnv>),
    // CURRENT writeGuard({ feature: "xid_links" }): no active-X requirement.
    (c, next) => writeGuardMiddleware({ ...originOptions(c), requiredRole: null })(c, next),
    costGuardMiddleware("xid_links") as MiddlewareHandler<AppEnv>,
    dbMiddleware,
  ];
  return async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    // A deny returned by an inner middleware must reach Hono, so it is carried out through 'inner'.
    const run = async (index: number): Promise<Response | void> => {
      if (index === stack.length) return next();
      let inner: Response | void = undefined;
      const own = await stack[index]!(c, async () => {
        inner = await run(index + 1);
      });
      return own ?? inner;
    };
    return run(0);
  };
}

export function createXIdRoutes(options: { session?: MiddlewareHandler<AppEnv> } = {}): Hono<AppEnv> {
  const xid = new Hono<AppEnv>();
  xid.route("/", createXIdRequestRoutes(xidWriteStack(options.session))); // MIG-0659 SA-099..101
  return xid;
}

export const xidRoutes = createXIdRoutes();
