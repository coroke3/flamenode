import type { xUsers } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";
import {
  compensatePublicVisibilityFenceOnD1Failure,
  planPublicVisibilityFenceTransition,
  preCommitPublicVisibilityFence,
  type PublicVisibilityFencePlan,
} from "./fenceTransition.ts";
import type { VisibilityFenceHost } from "./manifestHost.ts";

type XUserApprovalStatus = typeof xUsers.$inferSelect["approval_status"];

export type XUserVisibilityFencePlan = PublicVisibilityFencePlan<XUserApprovalStatus>;

/** The listable approval statuses are shared with the workers' SQL, so the host passes them in. */
export type XUserVisibilityHost = {
  listableApprovalStatuses: readonly string[];
};

/** X ユーザーの一覧掲載可否が変わるときの fence planner（entity_type: "x_user"）。 */
export function planXUserVisibilityFenceTransition(
  input: {
    db: ServerCoreDb;
    xUserId: string;
    previousStatus: XUserApprovalStatus;
    nextStatus: XUserApprovalStatus;
    actorUserId: string;
    reason?: string | null;
    now: number;
  },
  host: XUserVisibilityHost,
): Promise<XUserVisibilityFencePlan> {
  const { xUserId, ...rest } = input;
  return planPublicVisibilityFenceTransition({
    ...rest,
    entityType: "x_user",
    entityId: xUserId,
    isPublic: (status) => host.listableApprovalStatuses.some((value) => value === status),
  });
}

export function preCommitXUserVisibilityTransition(
  input: {
    xUserId: string;
    fenceToken: string;
    reason?: string | null;
  },
  host: VisibilityFenceHost,
): Promise<void> {
  return preCommitPublicVisibilityFence(
    {
      entityType: "x_user",
      entityId: input.xUserId,
      fenceToken: input.fenceToken,
      reason: input.reason,
    },
    host,
  );
}

export function compensateXUserVisibilityOnD1Failure(
  input: {
    db: ServerCoreDb;
    xUserId: string;
    fenceToken: string;
  },
  host: VisibilityFenceHost,
): Promise<void> {
  return compensatePublicVisibilityFenceOnD1Failure(
    {
      db: input.db,
      entityType: "x_user",
      entityId: input.xUserId,
      fenceToken: input.fenceToken,
      flow: "x_user_visibility",
    },
    host,
  );
}
