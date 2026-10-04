import "server-only";

import type { DB } from "@/lib/db/client";
import type { eventGroups } from "@/lib/db/schema";
import {
  compensatePublicVisibilityFenceOnD1Failure,
  planPublicVisibilityFenceTransition,
  preCommitPublicVisibilityFence,
  type PublicVisibilityFencePlan,
} from "@/lib/publicData/publicVisibilityFenceTransition";

type EventGroupVisibilityStatus = typeof eventGroups.$inferSelect["visibility_status"];

export type EventGroupVisibilityFencePlan =
  PublicVisibilityFencePlan<EventGroupVisibilityStatus>;

/**
 * event_groups の公開状態変更を D1 mutation と同一 batch に載せるための
 * fence planner（entity_type: "event_group"）。
 */
export function planEventGroupVisibilityFenceTransition(input: {
  db: DB;
  groupId: string;
  previousStatus: EventGroupVisibilityStatus;
  nextStatus: EventGroupVisibilityStatus;
  actorUserId: string;
  reason?: string | null;
  now: number;
}): Promise<EventGroupVisibilityFencePlan> {
  const { groupId, ...rest } = input;
  return planPublicVisibilityFenceTransition({
    ...rest,
    entityType: "event_group",
    entityId: groupId,
    isPublic: (status) => status === "public",
  });
}

export function preCommitEventGroupVisibilityTransition(input: {
  groupId: string;
  fenceToken: string;
  reason?: string | null;
}): Promise<void> {
  return preCommitPublicVisibilityFence({
    entityType: "event_group",
    entityId: input.groupId,
    fenceToken: input.fenceToken,
    reason: input.reason,
  });
}

export function compensateEventGroupVisibilityOnD1Failure(input: {
  db: DB;
  groupId: string;
  fenceToken: string;
}): Promise<void> {
  return compensatePublicVisibilityFenceOnD1Failure({
    db: input.db,
    entityType: "event_group",
    entityId: input.groupId,
    fenceToken: input.fenceToken,
    flow: "event_group_visibility",
  });
}
