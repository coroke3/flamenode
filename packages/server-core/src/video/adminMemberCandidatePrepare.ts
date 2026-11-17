/**
 * MIG-0650 U03bi: UNMOUNTED Hono SA-085 write-plan orchestration.
 *
 * Deliberately stops BEFORE any D1 batch, Queue wake, route registration or
 * HTTP response. The future Hono host must prove origin/session/admin/TOS,
 * CostGuard, canonical target SELECT and full-body/workerd policy first.
 * It must instrument EVERY invocation-local D1 read and supply the measured
 * count *after* this function's canonicalization/planning reads.
 */
import type { videos } from "@flamenode/db/schema";
import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";
import type { ValidatedMemberSubmission } from "@flamenode/domain/video/adminMemberSubmission";
import type { ServerCoreDb } from "../db.ts";
import type { PreloadedAuditContext } from "../audit/logger.ts";
import { isValidPreloadedActorSnapshotJson } from "../audit/logger.ts";
import { MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "../staticRebuild/hooks.ts";
import { buildReplaceVideoMembersPlan } from "./replaceVideoMembers.ts";
import {
  assembleAdminVideoMemberAtomicPlan,
  type AdminMemberAtomicAssembly,
} from "./adminMemberAtomicAssembly.ts";
import {
  prepareAdminMemberAtomicExecution,
  type AdminMemberAtomicExecutionInput,
} from "./adminMemberAtomicExecute.ts";
import type { AtomicAuditMutationInput } from "../audit/mutate.ts";

type AuthorizedTarget = Pick<
  typeof videos.$inferSelect,
  "id" | "collaboration_type" | "visibility_status" |
  "creator_x_user_id" | "updated_at"
>;

export type AdminMemberCandidatePrepareInput = {
  /** Supplied ONLY by the authenticated target-video D1 SELECT, not JSON. */
  target: AuthorizedTarget;
  videoId: string;
  actorUserId: string;
  validated: ValidatedMemberSubmission;
  isCollab: boolean;
  /** Derived from the authorized video/linked-events SELECT, never the body. */
  eventIds: readonly string[];
  now: number;
  /** Values verified by the Hono write guard in this request. */
  preloaded: PreloadedAuditContext;
  /**
   * Return the current request's measured logical D1 reads, including guard,
   * CostGuard, target video, canonical X and all member/chapter reads.
   * A fixed estimate or an uninstrumented production D1 binding is UNSAFE.
   */
  readMeasuredCallerQueries: () => number;
};

export type AdminMemberCandidatePrepared = {
  assembly: AdminMemberAtomicAssembly;
  executionInput: AdminMemberAtomicExecutionInput;
  /** Input preflight for the shared strict audit executor, or no-op. */
  atomic: AtomicAuditMutationInput | null;
};

function invalid(): never {
  throw new RangeError("video_admin_member_candidate_prepare_invalid");
}

/**
 * Compose CURRENT member replacement, metadata, strict audit and JSON1 Queue
 * from an authorized guard snapshot. Builds SQL but never executes it.
 */
export async function prepareAdminVideoMemberCandidateWrite(
  db: ServerCoreDb,
  input: AdminMemberCandidatePrepareInput,
): Promise<AdminMemberCandidatePrepared> {
  const { target, videoId, actorUserId, validated, isCollab, eventIds, now, preloaded } = input;
  if (
    !target || typeof videoId !== "string" || !videoId ||
    target.id !== videoId ||
    (target.collaboration_type !== "individual" && target.collaboration_type !== "collab") ||
    typeof actorUserId !== "string" || !actorUserId ||
    typeof isCollab !== "boolean" ||
    !Number.isSafeInteger(now) || now < 0 ||
    !validated || !Array.isArray(validated.members) ||
    validated.members.length > MAX_VIDEO_MEMBERS ||
    !(validated.chaptersByIndex instanceof Map) ||
    !Array.isArray(eventIds) ||
    eventIds.length > MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS ||
    eventIds.some(id => typeof id !== "string" || !id || id.trim() !== id) ||
    new Set(eventIds).size !== eventIds.length ||
    !preloaded?.settings ||
    !isValidPreloadedActorSnapshotJson(preloaded.actorSnapshotJsonById?.[actorUserId]) ||
    typeof input.readMeasuredCallerQueries !== "function"
  ) invalid();

  // A future Hono caller must pass ONLY validateVideoMemberSubmission output.
  // The shared planner performs canonical X resolution and authoritative D1
  // reads, not untrusted body-provided member rows or audit snapshots.
  const membersPlan = await buildReplaceVideoMembersPlan(db, {
    videoId,
    members: validated.members,
    chaptersByIndex: validated.chaptersByIndex,
    actorUserId,
  });
  const assembly = await assembleAdminVideoMemberAtomicPlan(db, {
    target,
    membersPlan,
    members: validated.members,
    isCollab,
    eventIds,
    actorUserId,
    now,
  });
  // Collect this value AFTER all planning D1 reads. Do not use the budget's
  // conservative 18-read estimate as if it were measured evidence.
  const callerQueryCount = input.readMeasuredCallerQueries();
  const executionInput: AdminMemberAtomicExecutionInput = {
    assembly, videoId, actorUserId, callerQueryCount, preloaded,
  };
  const atomic = prepareAdminMemberAtomicExecution(executionInput);
  return { assembly, executionInput, atomic };
}
