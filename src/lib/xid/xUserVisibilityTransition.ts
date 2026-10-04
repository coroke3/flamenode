import "server-only";

import type { DB } from "@/lib/db/client";
import type { xUsers } from "@/lib/db/schema";
import {
  compensatePublicVisibilityFenceOnD1Failure,
  planPublicVisibilityFenceTransition,
  preCommitPublicVisibilityFence,
  type PublicVisibilityFencePlan,
} from "@/lib/publicData/publicVisibilityFenceTransition";
import { PUBLIC_LISTABLE_X_APPROVAL_STATUSES } from "@/lib/utils/publicXUser";

type XUserApprovalStatus = typeof xUsers.$inferSelect["approval_status"];

export type XUserVisibilityFencePlan = PublicVisibilityFencePlan<XUserApprovalStatus>;

function isListable(status: XUserApprovalStatus): boolean {
  return PUBLIC_LISTABLE_X_APPROVAL_STATUSES.some((value) => value === status);
}

/** X ユーザーの一覧掲載可否が変わるときの fence planner（entity_type: "x_user"）。 */
export function planXUserVisibilityFenceTransition(input: {
  db: DB;
  xUserId: string;
  previousStatus: XUserApprovalStatus;
  nextStatus: XUserApprovalStatus;
  actorUserId: string;
  reason?: string | null;
  now: number;
}): Promise<XUserVisibilityFencePlan> {
  const { xUserId, ...rest } = input;
  return planPublicVisibilityFenceTransition({
    ...rest,
    entityType: "x_user",
    entityId: xUserId,
    isPublic: isListable,
  });
}

export function preCommitXUserVisibilityTransition(input: {
  xUserId: string;
  fenceToken: string;
  reason?: string | null;
}): Promise<void> {
  return preCommitPublicVisibilityFence({
    entityType: "x_user",
    entityId: input.xUserId,
    fenceToken: input.fenceToken,
    reason: input.reason,
  });
}

export function compensateXUserVisibilityOnD1Failure(input: {
  db: DB;
  xUserId: string;
  fenceToken: string;
}): Promise<void> {
  return compensatePublicVisibilityFenceOnD1Failure({
    db: input.db,
    entityType: "x_user",
    entityId: input.xUserId,
    fenceToken: input.fenceToken,
    flow: "x_user_visibility",
  });
}
