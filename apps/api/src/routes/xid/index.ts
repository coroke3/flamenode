/**
 * MIG-0659 (D-15-8): /api/xid router. MIG-0636 (Personal X / Active X APIs) shares this file.
 *
 * Write stacks:
 * - SA-098 (`POST /active`): own one-read guard (origin -> session -> combined TOS/CostGuard/X -> db).
 * - SA-099..101 (`requests` / `cancel` / `merge-revert-requests`): xidWriteStack (origin -> session -> writeGuard -> CostGuard -> db).
 * - SA-102..105 (`PATCH /:xUserId/profile`, `DELETE /:xUserId`, `PUT /:xUserId/icon`, `POST /:xUserId/icon/upload`):
 *   xidSessionStack (origin -> session -> authenticated -> db) + route 1-SELECT combined TOS/CostGuard/X preflight.
 */
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { sessionMiddleware } from "../../auth/session.ts";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../../middleware/writeOrigin.ts";
import { activeXRoutes } from "./activeX.ts";
import { createXIdIconSelectRoutes } from "./iconSelect.ts";
import { createXIdIconUploadRoutes } from "./iconUpload.ts";
import { createXIdProfileRoutes } from "./profile.ts";
import { createXIdRequestRoutes } from "./requests.ts";
import { createXIdUnlinkRoutes } from "./unlink.ts";
import { xidSessionStack } from "./xidGuard.ts";

export { xidSessionStack };

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
  // SA-098 uses a single D1 identity/TOS/CostGuard snapshot; do not run the
  // SA-099..101 write stack again or consume its additional D1 reads.
  // Preserve 404/405 semantics for non-POST and unknown routes.
  const activeOrigin = (c: Context<AppEnv>) => ({
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
    allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
  });
  xid.use("/active", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  xid.use("/active", (c, next) =>
    c.req.method === "POST" ? originGuardMiddleware(activeOrigin(c))(c, next) : next(),
  );
  xid.use("/active", (c, next) =>
    c.req.method === "POST" ? (options.session ?? sessionMiddleware())(c, next) : next(),
  );
  const sessionGuard = xidSessionStack(options.session);
  xid.route("/active", activeXRoutes); // MIG-0636 SA-098: own one-read write guard
  xid.route("/", createXIdRequestRoutes(xidWriteStack(options.session))); // MIG-0659 SA-099..101
  xid.route("/", createXIdProfileRoutes(sessionGuard)); // MIG-0636 SA-102
  xid.route("/", createXIdUnlinkRoutes(sessionGuard)); // MIG-0636 SA-103
  xid.route("/", createXIdIconSelectRoutes(sessionGuard)); // MIG-0636 SA-104
  xid.route("/", createXIdIconUploadRoutes(sessionGuard)); // MIG-0636 SA-105
  return xid;
}

// Compatibility alias for MIG-0636 existing route tests and callers.
export const createXidRoutes = createXIdRoutes;
export const xidRoutes = createXIdRoutes();
