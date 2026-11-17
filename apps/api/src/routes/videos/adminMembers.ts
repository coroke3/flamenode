/**
 * MIG-0650 U03e: UNMOUNTED SA-085 admin-members PUT preflight candidate.
 *
 * The authenticated Hono D1 member/chapters CAS + strict audit + static
 * rebuild host has not yet been implemented. This candidate MUST return 501
 * even for a valid request. Never mount it or represent it as a working writer.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { readAdminVideoCollabFlag } from "@flamenode/domain/video";
import { parseAdminVideoMembersHttpInput } from "@flamenode/domain/video/adminMemberHttpInput";
import { validateVideoMemberSubmission } from "@flamenode/domain/video/adminMemberSubmission";
import type { AppEnv } from "../../env.ts";
import { sessionMiddleware } from "../../auth/session.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../../middleware/writeOrigin.ts";
import { BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../admin/body.ts";

type Ctx = Context<AppEnv>;

export type VideoAdminMembersPreflightHost = {
  writeGuard: MiddlewareHandler<AppEnv>;
};

/**
 * Required order before any request body or member data is inspected:
 * origin -> session -> admin identity/TOS -> CostGuard(edit_video) -> db.
 * This merely prepares the UNMOUNTED preflight; no host mutation port exists.
 */
export function createDefaultVideoAdminMembersPreflightHost(
  options: { session?: MiddlewareHandler<AppEnv> } = {},
): VideoAdminMembersPreflightHost {
  const originOptions = (c: Ctx) => ({
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
    allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
  });
  const stack: MiddlewareHandler<AppEnv>[] = [
    (c, next) => originGuardMiddleware(originOptions(c))(c, next),
    options.session ?? (sessionMiddleware() as unknown as MiddlewareHandler<AppEnv>),
    (c, next) => writeGuardMiddleware({
      ...originOptions(c),
      requiredRole: "admin",
    })(c, next),
    costGuardMiddleware("edit_video") as MiddlewareHandler<AppEnv>,
    dbMiddleware,
  ];
  return {
    writeGuard: async (c, next) => {
      c.header("Cache-Control", "private, no-store");
      const execute = async (index: number): Promise<Response | void> => {
        if (index === stack.length) return next();
        let child: Response | void;
        const result = await stack[index]!(c, async () => {
          child = await execute(index + 1);
        });
        return result ?? child;
      };
      return execute(0);
    },
  };
}

function reject(c: Ctx, status: 400 | 403 | 413 | 501 | 503, message: string): Response {
  c.header("Cache-Control", "private, no-store");
  return c.json({ ok: false, message }, status);
}

/** NOT mounted in createVideosRoutes. No D1 mutation or Queue wake exists. */
export function createVideoAdminMembersPreflightRoutes(
  host: VideoAdminMembersPreflightHost,
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.put("/:videoId/members", host.writeGuard, async c => {
    c.header("Cache-Control", "private, no-store");
    const actor = c.get("user");
    const db = c.get("db");
    if (!actor || !db || !c.get("auditSettings") || !c.get("actorSnapshotJsonById")) {
      return reject(c, 503, "書込認証を確認できませんでした。");
    }
    if (actor.role !== "admin") return reject(c, 403, "管理者権限が必要です。");

    const body = await readAdminJsonBody(c.req.raw);
    if (body.kind === "too_large") return reject(c, 413, BODY_TOO_LARGE_MESSAGE);
    if (body.kind !== "ok") return reject(c, 400, "入力エラー");

    const videoId = c.req.param("videoId");
    const parsed = parseAdminVideoMembersHttpInput(videoId, body.value);
    if (!parsed.ok) return reject(c, 400, parsed.message);
    const isCollab = readAdminVideoCollabFlag(parsed.formData);
    const members = validateVideoMemberSubmission(parsed.formData, isCollab);
    if (!members.ok) return reject(c, 400, members.message);

    // Validity is not authorization to mutate the video. We have no Hono
    // per-video admin D1 lookup, atomic member CAS/audit plan, or Queue port yet.
    // Deliberately never return a successful save response.
    return reject(c, 501, "参加者設定の保存APIは移行準備中です。");
  });
  return routes;
}
