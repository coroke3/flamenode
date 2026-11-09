import {
  resolveXIdLinkRequestAuthorization,
  type XAuthorizationEvidence,
} from "@flamenode/server-core/auth/ownership";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import type { SessionUserLike } from "@flamenode/domain/video";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../../env.ts";

export type XIdLinkReviewAuthorization =
  | XAuthorizationEvidence
  | { allowed: false; actorXUserId: null; message: string };

/**
 * SA-090/091 review authority is separate from the generic xid_links write guard.
 * Admins are allowed directly; staff must hold xid.link_requests on an approved
 * linked X identity. The returned actor is the identity that actually granted access.
 */
export async function authorizeXIdLinkRequestReview(
  db: ServerCoreDb,
  user: SessionUserLike,
): Promise<XIdLinkReviewAuthorization> {
  const evidence = await resolveXIdLinkRequestAuthorization(db, user);
  return evidence.allowed
    ? evidence
    : {
        allowed: false,
        actorXUserId: null,
        message: "X ID 申請を処理する権限がありません。",
      };
}

/**
 * Runs after xidWriteStack: origin, session, write identity, CostGuard and D1
 * are already established. Store the authorizing X identity for the mutation's
 * audit actor; never infer it later from an untrusted request field.
 */
export const xidLinkRequestReviewAuthorizationMiddleware: MiddlewareHandler<AppEnv> =
  async (c, next) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ ok: false, message: "ログインが必要です。" }, 401);
    }
    try {
      const evidence = await authorizeXIdLinkRequestReview(c.get("db"), user);
      if (!evidence.allowed) {
        return c.json({ ok: false, message: evidence.message }, 403);
      }
      c.set("xidLinkRequestActorXUserId", evidence.actorXUserId);
      await next();
    } catch (error) {
      console.error("[xid] review authorization failed", error);
      return c.json({ ok: false, message: "時間をおいて再試行してください。" }, 503);
    }
  };
