/**
 * MIG-0650 U03ax: shared SA-085 assembly for a future authenticated Hono host.
 *
 * The caller must first validate/admin-authorize the request and obtain the
 * canonical member plan with buildReplaceVideoMembersPlan. It must then run
 * the returned statements, strict audits and Queue rows in ONE atomic D1
 * transaction, and wake the Queue only after commit. This module performs no
 * D1 read/execute, audit insertion, Queue wake or route registration.
 *
 * CURRENT Next stays the authoritative live route until browser parity,
 * workerd input/CPU budget and independent security review are complete.
 */
import type { BatchItem } from "drizzle-orm/batch";
import type { videos } from "@flamenode/db/schema";
import type { WriteAuditLogInput } from "../audit/types.ts";
import type { ServerCoreDb } from "../db.ts";
import {
  buildStaticRebuildQueueBatch,
  type StaticRebuildQueueBatch,
} from "../staticRebuild/enqueue.ts";
import type { EnqueueStaticRebuildInput } from "../staticRebuild/types.ts";
import { deriveAdminVideoMemberSaveEffects } from "./memberAggregationFanOut.ts";
import { buildAdminVideoMemberMetadataPlan } from "./adminMemberMetadataPlan.ts";
import { adminVideoMembersRebuildTargets } from "./adminMemberRebuildTargets.ts";

type MemberAtomicPlan = {
  statements: BatchItem<"sqlite">[];
  expectedChanges: (number | null)[];
  audits: WriteAuditLogInput[];
};
type Target = Pick<
  typeof videos.$inferSelect,
  "id" | "collaboration_type" | "visibility_status" |
  "creator_x_user_id" | "updated_at"
>;

export type AdminMemberAtomicAssembly = {
  plan: MemberAtomicPlan;
  queue: StaticRebuildQueueBatch;
  targets: EnqueueStaticRebuildInput[];
  noOp: boolean;
};

/**
 * Assemble metadata, strict audit and durable static-rebuild Queue writes
 * around a pre-built member/chapter CAS plan. No mutation is executed here.
 *
 * The Hono caller MUST reject stale or forged authorized target snapshots,
 * count its actual D1 preparation reads, and run exactly one audited atomic
 * batch before sending any Queue wake.
 */
export async function assembleAdminVideoMemberAtomicPlan(
  db: ServerCoreDb,
  input: {
    target: Target;
    membersPlan: MemberAtomicPlan;
    members: ReadonlyArray<{ x_user_id: string }>;
    isCollab: boolean;
    eventIds: readonly string[];
    actorUserId: string;
    now: number;
  },
): Promise<AdminMemberAtomicAssembly> {
  if (
    !input.target.id ||
    !input.actorUserId ||
    !Number.isSafeInteger(input.now) || input.now < 0 ||
    input.membersPlan.statements.length !== input.membersPlan.expectedChanges.length ||
    input.membersPlan.expectedChanges.some(
      n => n !== null && (!Number.isSafeInteger(n) || n < 0),
    ) ||
    // The Hono host must not accept a member CAS without its strict,
    // same-video, same-actor audit or splice a forged audit into the batch.
    (input.membersPlan.statements.length === 0) !==
      (input.membersPlan.audits.length === 0) ||
    input.membersPlan.audits.some(audit =>
      audit.strict !== true ||
      audit.target_id !== input.target.id ||
      audit.actor_user_id !== input.actorUserId
    )
  ) {
    throw new RangeError("video_admin_member_atomic_assembly_invalid_input");
  }
  // MIG-0650 U03az: the separate CURRENT member planner emits exactly four
  // supported strict audit types. Reject a mislabeled audit, a duplicate
  // category, or a pre/post snapshot tied to another video BEFORE metadata
  // or Queue SQL is built. Otherwise a future Hono adapter could accidentally
  // turn a member-set CAS into an unrelated audit or hide the member-changed
  // signal used by public rebuild fanout.
  const allowedMemberAuditOperations: Record<string, "MERGE" | "DELETE"> = {
    x_users_member_batch: "MERGE",
    video_member_hidden_carry_cleanup: "DELETE",
    video_chapters_member_set: "MERGE",
    video_members_set: "MERGE",
  };
  const seenAuditTables = new Set<string>();
  if (input.membersPlan.audits.some(audit => {
    const expectedOperation = allowedMemberAuditOperations[audit.table_name];
    if (
      !expectedOperation || audit.operation !== expectedOperation ||
      seenAuditTables.has(audit.table_name) ||
      audit.after?.id !== input.target.id ||
      (audit.table_name === "x_users_member_batch"
        ? audit.before != null
        : audit.before?.id !== input.target.id)
    ) {
      return true;
    }
    seenAuditTables.add(audit.table_name);
    return false;
  })) {
    throw new RangeError("video_admin_member_atomic_assembly_invalid_audit");
  }

  // The live Next flow classifies these effects from the same audited
  // membersPlan; never infer membersChanged from a request JSON flag.
  const effects = deriveAdminVideoMemberSaveEffects({
    membersPlan: input.membersPlan,
    previousCollaborationType: input.target.collaboration_type,
    members: input.members,
    isCollab: input.isCollab,
    isPublicVideo: input.target.visibility_status === "public",
    creatorXUserId: input.target.creator_x_user_id,
  });
  // MIG-0650 U03ay: validate bounded event/creator fanout before allocating
  // the video UPDATE or Queue SQL. This builder is pure, and reordering it
  // does not change the CURRENT statement/audit/Queue ordering.
  const targets = adminVideoMembersRebuildTargets({
    videoId: input.target.id,
    actorUserId: input.actorUserId,
    publicContentChanged: effects.videoPublicContentChanged,
    membersPlanChanged: effects.membersPlanChanged,
    eventIds: input.eventIds,
    isPublicVideo: input.target.visibility_status === "public",
    affectedCreatorIds: effects.affectedCreatorIds,
  });
  const metadataPlan = buildAdminVideoMemberMetadataPlan(db, {
    target: input.target,
    nextCollaborationType: effects.nextCollaborationType,
    now: input.now,
    actorUserId: input.actorUserId,
    publicContentChanged: effects.videoPublicContentChanged,
  });
  const plan: MemberAtomicPlan = {
    statements: [...input.membersPlan.statements, ...metadataPlan.statements],
    expectedChanges: [
      ...input.membersPlan.expectedChanges,
      ...metadataPlan.expectedChanges,
    ],
    audits: [...input.membersPlan.audits, ...metadataPlan.audits],
  };

  // CURRENT returns before constructing a Queue batch for true no-ops.
  // The caller must not generate an audit or wake for this path.
  if (plan.statements.length === 0) {
    if (plan.audits.length || targets.length) {
      throw new Error("video_admin_member_noop_effect_mismatch");
    }
    return {
      plan,
      queue: { statements: [], expectedChanges: [], acceptedTargetCount: 0 },
      targets,
      noOp: true,
    };
  }
  // JSON1 Queue statements are part of the SAME batch and strict audit
  // failure/changes() mismatch must rollback member/metadata/Queue together.
  const queue = await buildStaticRebuildQueueBatch(db, targets);
  plan.statements.push(...queue.statements);
  plan.expectedChanges.push(...queue.expectedChanges);
  if (plan.statements.length !== plan.expectedChanges.length ||
      plan.audits.length === 0) {
    throw new Error("video_admin_member_atomic_assembly_incomplete");
  }
  return { plan, queue, targets, noOp: false };
}
