/**
 * MIG-0650 U03bi: UNMOUNTED Hono SA-085 write-plan orchestration.
 *
 * Deliberately stops BEFORE any D1 batch, Queue wake, route registration or
 * HTTP response. The future Hono host must prove origin/session/admin/TOS,
 * CostGuard, canonical target SELECT and full-body/workerd policy first.
 * It must instrument EVERY invocation-local D1 read and supply the measured
 * count *after* this function's canonicalization/planning reads.
 */

import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";
import { isCanonicalXId } from "@flamenode/domain/xid";
import {
  normalizeMemberChapters,
  type ValidatedMemberSubmission,
} from "@flamenode/domain/video/adminMemberSubmission";
import type { ServerCoreDb } from "../db.ts";
import type { PreloadedAuditContext } from "../audit/logger.ts";
import { isValidPreloadedActorSnapshotJson } from "../audit/logger.ts";
import { MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "../staticRebuild/hooks.ts";
import { buildReplaceVideoMembersPlan } from "./replaceVideoMembers.ts";
import {
  assembleAdminVideoMemberAtomicPlan,
  type AdminMemberAtomicAssembly,
  type AdminMemberAuthorizedTarget,
} from "./adminMemberAtomicAssembly.ts";
import {
  prepareAdminMemberAtomicExecution,
  type AdminMemberAtomicExecutionInput,
} from "./adminMemberAtomicExecute.ts";
import type { AtomicAuditMutationInput } from "../audit/mutate.ts";

type AuthorizedTarget = AdminMemberAuthorizedTarget;

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
 * This boundary consumes the exact normalized output of
 * validateVideoMemberSubmission, not arbitrary body/host-provided chapter maps.
 * A missing index can silently omit one member's chapters; an extra index
 * can be ignored by the projection and conceal an invalid request.
 * Reject both before any canonicalization/alias D1 reads.
 */
function hasValidNormalizedMemberShape(
  validated: ValidatedMemberSubmission,
  isCollab: boolean,
): boolean {
  if (!validated || !Array.isArray(validated.members) ||
      validated.members.length > MAX_VIDEO_MEMBERS ||
      !(validated.chaptersByIndex instanceof Map) ||
      validated.chaptersByIndex.size !== validated.members.length ||
      (!isCollab && validated.members.length > 0)) return false;

  // CURRENT's validator trims input, synthesizes a nonempty name, and
  // disallows duplicate nonempty X handles. Do not trust a forged "validated"
  // payload with the same structural shape but different persisted values.
  const seenXIds = new Set<string>();
  for (const [index, member] of validated.members.entries()) {
    if (!member ||
        typeof member.name !== "string" || !member.name ||
        member.name.length > 80 || member.name !== member.name.trim() ||
        typeof member.x_user_id !== "string" ||
        (member.x_user_id !== "" && !isCanonicalXId(member.x_user_id)) ||
        typeof member.role !== "string" || member.role.length > 80 ||
        member.role !== member.role.trim() ||
        typeof member.comment !== "string" || member.comment.length > 500 ||
        member.comment !== member.comment.trim() ||
        !Array.isArray(member.chapters) || member.chapters.length > 30) return false;
    if (member.x_user_id) {
      if (seenXIds.has(member.x_user_id)) return false;
      seenXIds.add(member.x_user_id);
    }
    if (member.chapters.some(ch =>
      !ch || typeof ch.time !== "string" || ch.time !== ch.time.trim() ||
      typeof ch.label !== "string" || ch.label.length > 120 ||
      ch.label !== ch.label.trim() ||
      typeof ch.note !== "string" || ch.note.length > 1000 ||
      ch.note !== ch.note.trim()
    )) return false;
    const normalized = validated.chaptersByIndex.get(index);
    if (!Array.isArray(normalized) ||
        normalized.length !== member.chapters.length ||
        normalized.length > 30 ||
        normalized.some((ch, chapterIndex) =>
          !ch || !Number.isSafeInteger(ch.time_seconds) ||
          ch.time_seconds < 0 || ch.time_seconds > 9999 * 60 + 59 ||
          ch.order_index !== chapterIndex ||
          typeof ch.label !== "string" || ch.label.length > 120 ||
          typeof ch.note !== "string" || ch.note.length > 1000
        )) return false;
    // A same-sized, structurally valid Map can still contain forged normalized
    // times, labels or notes. Bind every projected chapter value to exactly
    // what CURRENT's validator derives from the same raw member input.
    const canonical = normalizeMemberChapters(member, index);
    if (!canonical.ok || canonical.chapters.some((expected, chapterIndex) => {
      const provided = normalized[chapterIndex];
      return !provided || provided.time_seconds !== expected.time_seconds ||
        provided.order_index !== expected.order_index ||
        provided.label !== expected.label ||
        provided.note !== expected.note;
    })) return false;
  }
  return true;
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
    !["draft", "pending", "public", "limited", "private", "archived", "voided"]
      .includes(target.visibility_status) ||
    !Number.isSafeInteger(target.updated_at) || target.updated_at < 0 ||
    (target.creator_x_user_id !== null && typeof target.creator_x_user_id !== "string") ||
    typeof actorUserId !== "string" || !actorUserId ||
    typeof isCollab !== "boolean" ||
    !Number.isSafeInteger(now) || now < 0 ||
    !hasValidNormalizedMemberShape(validated, isCollab) ||
    !Array.isArray(eventIds) ||
    eventIds.length > MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS ||
    // Guard sparse arrays independently of the final atomic assembly.
    Array.from(eventIds).some(id =>
      typeof id !== "string" || !id || id.trim() !== id
    ) ||
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
