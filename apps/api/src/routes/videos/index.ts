/**
 * MIG-0603: /api/videos router (U01 RH-030 detail; U02b SA-012..015 chapter
 * writes; RH-031/032 and the other writes are pending, see the work item).
 * The public GET stays guard-free and cacheable; every chapter write goes
 * through videoWriteStack (same order as the admin routes): no-store header,
 * origin (pure, before any D1 read), session, then writeGuard with CURRENT's
 * chapter options (any role, CostGuard "chapter_comment", approved active X).
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { sessionMiddleware } from "../../auth/session.ts";
import type { AppEnv } from "../../env.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../../middleware/writeOrigin.ts";
import { createChapterRoutes } from "./chapters.ts";
import { videoDetailRoutes } from "./detail.ts";

function videoWriteStack(session?: MiddlewareHandler<AppEnv>): MiddlewareHandler<AppEnv> {
  const originOptions = (c: Context<AppEnv>) => ({
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
    // Never derived from NODE_ENV: only the explicit preview flag.
    allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
  });
  const stack: MiddlewareHandler<AppEnv>[] = [
    (c, next) => originGuardMiddleware(originOptions(c))(c, next),
    session ?? (sessionMiddleware() as unknown as MiddlewareHandler<AppEnv>),
    (c, next) =>
      writeGuardMiddleware({
        ...originOptions(c),
        requiredRole: null,
        activeX: { requireApprovedActiveXId: true, feature: "chapter_comment" },
      })(c, next),
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

export function createVideosRoutes(
  options: { session?: MiddlewareHandler<AppEnv> } = {},
): Hono<AppEnv> {
  const videos = new Hono<AppEnv>();
  videos.route("/", videoDetailRoutes);
  videos.route("/", createChapterRoutes(videoWriteStack(options.session)));
  return videos;
}

export const videosRoutes = createVideosRoutes();
