/**
 * MIG-0603 U02a — deliberately UNMOUNTED manage status-write HTTP candidate.
 *
 * Connects CURRENT's Origin -> Session -> WriteGuard(identity/TOS/ban) ->
 * CostGuard -> bounded JSON -> event privilege + exact video link checks.
 * It never invokes a video mutation, even for an authorized user: moderation,
 * atomic audit, R2 manifest ownership, budget and post-commit HTTP parity
 * remain blocked. Do not register this router in apps/api/src/app.ts.
 */
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../env.ts";
import { sessionMiddleware } from "../../auth/session.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../../middleware/writeOrigin.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { parseManageVideoStatusInput } from "./videoStatusInput.ts";
import { checkManageVideoStatusAccess } from "./videoStatusAccess.ts";

const NO_STORE = "private, no-store";
const ORIGIN_OPTIONS = (c: Context<AppEnv>) => ({
  loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
  allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
});

export function createUnboundManageVideoStatusCandidate(): Hono<AppEnv> {
  const candidate = new Hono<AppEnv>();
  candidate.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", NO_STORE);
  });
  // Verify Origin before any session/D1 work; repeat inside the identity guard.
  candidate.use("*", (c, next) => originGuardMiddleware(ORIGIN_OPTIONS(c))(c, next));
  candidate.use("*", sessionMiddleware());
  candidate.use("*", (c, next) =>
    writeGuardMiddleware({ ...ORIGIN_OPTIONS(c), requiredRole: null })(c, next));
  candidate.use("*", dbMiddleware);
  candidate.use("*", costGuardMiddleware("manage_video_status"));

  candidate.post("/", async (c) => {
    const parsed = await parseManageVideoStatusInput(c.req.raw);
    if (!parsed.ok) return c.json({ ok: false, message: parsed.message }, parsed.status);
    const user = c.get("user");
    if (!user) return c.json({ ok: false, message: "ログインが必要です。" }, 401);
    try {
      const access = await checkManageVideoStatusAccess(
        c.get("db"), user, parsed.input.eventId, parsed.input.videoId,
      );
      if (!access.ok) {
        const code = access.message === "このイベントの作品審査権限がありません。" ? 403 : 404;
        return c.json(access, code);
      }
    } catch {
      // D1 provider errors can contain secrets or raw SQL. Never echo/log them.
      return c.json({ ok: false, reason: "database_unavailable" }, 503);
    }
    // FAIL-CLOSED: this is not a mutation endpoint. The authenticated
    // candidate must remain inactive until every acceptance gate is met.
    return c.json({ ok: false, reason: "status_candidate_unmounted" }, 503);
  });
  return candidate;
}
