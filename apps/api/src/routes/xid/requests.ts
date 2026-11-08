/**
 * MIG-0659 (SA-099..101, D-16-1): X ID link / cancel / merge-revert request API.
 *
 *   POST /api/xid/requests                       SA-099 requestXIdLink (JSON body = CURRENT FormData keys)
 *   POST /api/xid/requests/:id/cancel            SA-100 cancelXIdLinkRequest (id from the path, no body)
 *   POST /api/xid/merge-revert-requests          SA-101 requestXIdMergeRevert { parent_request_id }
 *
 * Guard (CURRENT writeGuard({ feature: "xid_links" })): same-origin, session, any role, banned / TOS
 * identity, CostGuard `xid_links`; NO active-X requirement (a user without an approved X ID must be able
 * to request one). The guard stack is supplied by the factory so the route cannot be mounted unguarded.
 * Responses are CURRENT's `{ ok, message? }` with `Cache-Control: private, no-store`. No Queue wake
 * (D-0603-1): the webhook outbox rows commit atomically with the request and audit rows.
 */
import {
  XIdMergeRevertBodySchema,
  XIdRequestBodySchema,
  type XIdRequestResult,
} from "@flamenode/contracts";
import {
  cancelXIdLinkRequestCore,
  requestXIdLinkCore,
  requestXIdMergeRevertCore,
  type XIdRequestContext,
  type XIdRequestOutcome,
} from "@flamenode/server-core/xid/requests";
import { normalizeXId } from "@flamenode/domain/xid";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../env.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../admin/body.ts";

const UNAVAILABLE_MESSAGE = "時間をおいて再試行してください。";

function respond(c: Context<AppEnv>, outcome: XIdRequestOutcome) {
  const body: XIdRequestResult = outcome.body;
  return c.json(body, outcome.status);
}

function fail(c: Context<AppEnv>, message: string, status: 400 | 413 | 503) {
  const body: XIdRequestResult = { ok: false, message };
  return c.json(body, status);
}

function contextOf(c: Context<AppEnv>): XIdRequestContext {
  const user = c.get("user")!;
  return {
    authUserId: user.id,
    actorXUserId: normalizeXId(user.active_x_user_id ?? "") || null,
    siteUrl: c.env.NEXT_PUBLIC_SITE_URL,
    preloaded: auditPreloaded(c),
  };
}

type JsonBody = { kind: "ok"; value: Record<string, unknown> } | { kind: "invalid" } | { kind: "too_large" };

async function readBody(c: Context<AppEnv>, optional: boolean): Promise<JsonBody> {
  if (optional && !c.req.raw.body) return { kind: "ok", value: {} };
  return readAdminJsonBody(c.req.raw);
}

export function createXIdRequestRoutes(guard: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post("/requests", guard, async (c) => {
    const input = await readBody(c, false);
    if (input.kind === "too_large") return fail(c, BODY_TOO_LARGE_MESSAGE, 413);
    if (input.kind !== "ok") return fail(c, "不正なリクエストです。", 400);
    const parsed = XIdRequestBodySchema.safeParse(input.value);
    if (!parsed.success) return fail(c, "不正なリクエストです。", 400);
    try {
      return respond(c, await requestXIdLinkCore(c.get("db"), contextOf(c), parsed.data));
    } catch (error) {
      console.error("[xid] requestXIdLink failed", error);
      return fail(c, `申請を保存できませんでした。${UNAVAILABLE_MESSAGE}`, 503);
    }
  });

  routes.post("/requests/:id/cancel", guard, async (c) => {
    // CURRENT takes no body here; a non-empty body is still size-bounded before it is ignored.
    const input = await readBody(c, true);
    if (input.kind === "too_large") return fail(c, BODY_TOO_LARGE_MESSAGE, 413);
    const requestId = (c.req.param("id") ?? "").trim();
    try {
      return respond(c, await cancelXIdLinkRequestCore(c.get("db"), contextOf(c), requestId));
    } catch (error) {
      console.error("[xid] cancelXIdLinkRequest failed", error);
      return fail(c, `申請の取り下げに失敗しました。${UNAVAILABLE_MESSAGE}`, 503);
    }
  });

  routes.post("/merge-revert-requests", guard, async (c) => {
    const input = await readBody(c, false);
    if (input.kind === "too_large") return fail(c, BODY_TOO_LARGE_MESSAGE, 413);
    if (input.kind !== "ok") return fail(c, "不正なリクエストです。", 400);
    const parsed = XIdMergeRevertBodySchema.safeParse(input.value);
    if (!parsed.success) return fail(c, "不正なリクエストです。", 400);
    try {
      return respond(
        c,
        await requestXIdMergeRevertCore(c.get("db"), contextOf(c), parsed.data.parent_request_id.trim()),
      );
    } catch (error) {
      console.error("[xid] requestXIdMergeRevert failed", error);
      return fail(c, `差し戻し申請を保存できませんでした。${UNAVAILABLE_MESSAGE}`, 503);
    }
  });

  return routes;
}
