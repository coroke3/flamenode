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
import type { D1AuditMutationBudget } from "../audit/mutateBudget.ts";
import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";
import { isCanonicalXId } from "@flamenode/domain/xid";
import type { ServerCoreDb } from "../db.ts";
import {
  buildStaticRebuildQueueBatch,
  type StaticRebuildQueueBatch,
} from "../staticRebuild/enqueue.ts";
import type { EnqueueStaticRebuildInput } from "../staticRebuild/types.ts";
import { deriveAdminVideoMemberSaveEffects } from "./memberAggregationFanOut.ts";
import { buildAdminVideoMemberMetadataPlan } from "./adminMemberMetadataPlan.ts";
import { adminVideoMembersRebuildTargets } from "./adminMemberRebuildTargets.ts";
import { inspectVideoAtomicWritePlanBudget } from "./videoAtomicBudget.ts";
import { parseVideoMemberSetSnapshot } from "./memberSetSnapshot.ts";

type MemberAtomicPlan = {
  statements: BatchItem<"sqlite">[];
  expectedChanges: (number | null)[];
  audits: WriteAuditLogInput[];
};
/**
 * CURRENT accepts seven persisted video states for admin member maintenance.
 * The older Drizzle schema infers only four visibility values; the Hono
 * authorized D1 SELECT and runtime guard deliberately accept all seven.
 * Widen only this candidate's already-validated snapshot, not the schema.
 */
export type AdminMemberAuthorizedTarget = Pick<
  typeof videos.$inferSelect,
  "id" | "collaboration_type" | "creator_x_user_id" | "updated_at"
> & {
  visibility_status:
    | "draft" | "pending" | "public" | "limited"
    | "private" | "archived" | "voided";
};
type Target = AdminMemberAuthorizedTarget;

export type AdminMemberAtomicAssembly = {
  plan: MemberAtomicPlan;
  queue: StaticRebuildQueueBatch;
  targets: EnqueueStaticRebuildInput[];
  noOp: boolean;
  /**
   * Conservative 18 pre-read projection for a future D1 mutation.
   * A real Hono writer must separately measure its caller reads at the
   * authenticated boundary; this is not production budget acceptance.
   */
  budget: D1AuditMutationBudget | null;
};

/**
 * Assemble metadata, strict audit and durable static-rebuild Queue writes
 * around a pre-built member/chapter CAS plan. No mutation is executed here.
 *
 * The Hono caller MUST reject stale or forged authorized target snapshots,
 * count its actual D1 preparation reads, and run exactly one audited atomic
 * batch before sending any Queue wake.
 */
/** CURRENT emits profile-create and hidden-cleanup audits only with real row work. */
function auditRows(snapshot: unknown): readonly unknown[] | null {
  if (!snapshot || typeof snapshot !== "object" || !("rows" in snapshot)) return null;
  return Array.isArray(snapshot.rows) ? snapshot.rows : null;
}

/** The CURRENT chapter audit is an aggregate, not a member-row snapshot. */
function auditChapterSummaryIsConsistent(
  snapshot: unknown,
  maxRows?: number,
): boolean {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const data = snapshot as Record<string, unknown>;
  const { row_count: rows, member_count: members, note_count: notes } = data;
  if (
    typeof rows !== "number" || !Number.isSafeInteger(rows) || rows < 0 ||
    typeof members !== "number" || !Number.isSafeInteger(members) ||
    members < 0 || members > rows ||
    typeof notes !== "number" || !Number.isSafeInteger(notes) ||
    notes < 0 || notes > rows ||
    (maxRows !== undefined && rows > maxRows)
  ) return false;
  if (rows === 0) {
    return members === 0 && notes === 0 &&
      data.min_time === null && data.max_time === null;
  }
  return typeof data.min_time === "number" &&
    Number.isFinite(data.min_time) &&
    typeof data.max_time === "number" &&
    Number.isFinite(data.max_time) &&
    data.min_time <= data.max_time;
}

/**
 * A same-video row ID alone does not make a valid member audit snapshot.
 * Invalid before snapshots previously became an empty previous-X set in
 * memberAggregationFanOut, silently omitting pages of removed members.
 * Parse the same CURRENT snapshot format used by that fanout before Queue
 * invalidations are derived. This does not execute a database statement.
 */
function auditMemberRowsBelongToVideo(
  snapshot: unknown,
  videoId: string,
  memberClass: "public" | "hidden",
): boolean {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const originalRows = auditRows(snapshot);
  const parsed = parseVideoMemberSetSnapshot(snapshot as Record<string, unknown>);
  if (!originalRows || !parsed || parsed.id !== videoId) return false;
  const limit = memberClass === "public" ? MAX_VIDEO_MEMBERS : MAX_VIDEO_MEMBERS * 2;
  if (parsed.rows.length > limit) return false;
  const expectedPublicFlag = memberClass === "public" ? 1 : 0;
  const seen = new Set<string>();
  return parsed.rows.every(row => {
    if (!row.id || seen.has(row.id) ||
      row.video_id !== videoId ||
      row.is_public_member !== expectedPublicFlag ||
      !Number.isSafeInteger(row.order_index) || row.order_index < 0 ||
      (row.can_edit !== 0 && row.can_edit !== 1)) return false;
    seen.add(row.id);
    return true;
  }) && originalRows.every(row =>
    row !== null && typeof row === "object" && !Array.isArray(row) &&
    // The snapshot parser coerces malformed optional types to null.
    // Fail closed before that coercion changes strict audit evidence.
    "x_user_id" in row &&
    (row.x_user_id === null || typeof row.x_user_id === "string") &&
    "role" in row &&
    (row.role === null || typeof row.role === "string") &&
    "comment" in row &&
    (row.comment === null || typeof row.comment === "string") &&
    "edit_granted_by_auth_user_id" in row &&
    (row.edit_granted_by_auth_user_id === null ||
      typeof row.edit_granted_by_auth_user_id === "string") &&
    "edit_granted_at" in row &&
    (row.edit_granted_at === null ||
      (typeof row.edit_granted_at === "number" &&
        Number.isSafeInteger(row.edit_granted_at))) &&
    "edit_updated_at" in row &&
    (row.edit_updated_at === null ||
      (typeof row.edit_updated_at === "number" &&
        Number.isSafeInteger(row.edit_updated_at)))
  );
}

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
    // This function is a separate trust boundary from candidate preparation:
    // TypeScript types do not validate a future host's runtime snapshot.
    !input.target || typeof input.target.id !== "string" || !input.target.id ||
    (input.target.collaboration_type !== "collab" &&
      input.target.collaboration_type !== "individual") ||
    !["draft", "pending", "public", "limited", "private", "archived", "voided"]
      .includes(input.target.visibility_status) ||
    !Number.isSafeInteger(input.target.updated_at) ||
    input.target.updated_at < 0 ||
    (input.target.creator_x_user_id !== null &&
      typeof input.target.creator_x_user_id !== "string") ||
    typeof input.actorUserId !== "string" || !input.actorUserId ||
    typeof input.isCollab !== "boolean" ||
    !Array.isArray(input.members) ||
    input.members.length > MAX_VIDEO_MEMBERS ||
    // Array#some skips sparse holes. A forged direct-call array with one
    // missing member is NOT an authorized nonempty members set.
    Array.from(input.members).some(member =>
      !member || typeof member.x_user_id !== "string" ||
      (member.x_user_id !== "" && !isCanonicalXId(member.x_user_id))
    ) ||
    !input.membersPlan ||
    !Array.isArray(input.membersPlan.statements) ||
    !Array.isArray(input.membersPlan.expectedChanges) ||
    !Array.isArray(input.membersPlan.audits) ||
    // Reject holes/null in candidate statements and audit entries before
    // metadata SQL generation. The atomic executor cannot execute a sparse
    // D1 batch or create a strict audit from an absent entry.
    Array.from(input.membersPlan.statements).some(statement => statement == null) ||
    Array.from(input.membersPlan.audits).some(audit => !audit || typeof audit !== "object") ||
    !Number.isSafeInteger(input.now) || input.now < 0 ||
    // The direct assembly boundary must not rely solely on the outer Hono
    // candidate input guard. Duplicate, empty or noncanonical linked-event
    // identifiers must not enter the eventual durable Queue fanout.
    !Array.isArray(input.eventIds) ||
    input.eventIds.some(id =>
      typeof id !== "string" || !id || id.trim() !== id
    ) ||
    new Set(input.eventIds).size !== input.eventIds.length ||
    input.membersPlan.statements.length !== input.membersPlan.expectedChanges.length ||
    Array.from(input.membersPlan.expectedChanges).some(
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
      // CURRENT creates new X profiles only for nonempty pending rows.
      (audit.table_name === "x_users_member_batch" &&
        (!auditRows(audit.after)?.length ||
         !auditRows(audit.after)?.every(row =>
           row !== null && typeof row === "object" &&
           !Array.isArray(row) && "id" in row &&
           typeof row.id === "string" && row.id.length > 0))) ||
      // Hidden-row cleanup must account for rows actually removed, not
      // falsely record a cleanup with an unchanged/remaining after-snapshot.
      (audit.table_name === "video_member_hidden_carry_cleanup" &&
        (!auditRows(audit.before)?.length ||
         auditRows(audit.after)?.length !== 0)) ||
      // Chapter audits contain bounded aggregate summaries rather than
      // member rows. A malformed or contradictory summary cannot serve as
      // the strict evidence for a future authenticated chapter write.
      (audit.table_name === "video_chapters_member_set" &&
        (!auditChapterSummaryIsConsistent(audit.before) ||
         !auditChapterSummaryIsConsistent(audit.after, MAX_VIDEO_MEMBERS * 30))) ||
      // Audit snapshots must not contain rows from any other video even when
      // their outer snapshot ID matches this target.
      ((audit.table_name === "video_members_set" ||
        audit.table_name === "video_member_hidden_carry_cleanup") &&
        (!auditMemberRowsBelongToVideo(
            audit.before, input.target.id,
            audit.table_name === "video_members_set" ? "public" : "hidden",
          ) ||
         !auditMemberRowsBelongToVideo(
            audit.after, input.target.id,
            audit.table_name === "video_members_set" ? "public" : "hidden",
          ))) ||
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
      budget: null,
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
  // U03bc: CURRENT's conservative pre-read reserve (18) is used until
  // an authenticated Hono executor can supply *measured* request-local
  // reads. Never hand an over-budget composed member+metadata+Queue plan
  // to a future atomic D1 executor. This performs no D1 operation.
  const budget = inspectVideoAtomicWritePlanBudget(plan);
  if (!budget.withinLimit) {
    throw new RangeError("video_admin_member_atomic_budget_exceeded");
  }
  return { plan, queue, targets, noOp: false, budget };
}
