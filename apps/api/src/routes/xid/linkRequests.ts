import {
  resolveXIdLinkRequestAuthorization,
  type XAuthorizationEvidence,
} from "@flamenode/server-core/auth/ownership";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import type { SessionUserLike } from "@flamenode/domain/video";

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
