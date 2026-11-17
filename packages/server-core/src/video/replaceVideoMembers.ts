/** MIG-0650 U03v: shared SA-085 member replacement read + CAS/audit plan.
 * CURRENT Next callers and future UNMOUNTED Hono writer use the same bounded
 * canonical-X read and deterministic statement plan. Caller owns guard, budget,
 * single atomic commit, strict audit, rebuild Queue and postcommit actions.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { videoChapters, videoMembers, xUsers } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";
import { generateId } from "../id.ts";
import { normalizeXId } from "@flamenode/domain/xid";
import type { MemberInput, ParsedMemberChapter } from "@flamenode/domain/video/adminMemberSubmission";
import type { BatchItem } from "drizzle-orm/batch";
import type { WriteAuditLogInput } from "../audit/types.ts";

type VideoAtomicWritePlan = {
  statements: BatchItem<"sqlite">[];
  expectedChanges: (number | null)[];
  audits: WriteAuditLogInput[];
};
function emptyVideoAtomicWritePlan(): VideoAtomicWritePlan {
  return { statements: [], expectedChanges: [], audits: [] };
}
import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";
import { buildVideoMemberSetSnapshot } from "./memberSetSnapshot.ts";

// Compatibility bridge (MIG-0650, D-10): SA-085 JSON1 chunking is shared with Hono.
export {
  chunkRowsByJsonByteSize,
  jsonUtf8ByteLength,
  VIDEO_CHAPTER_JSON_MAX_BYTES,
  VIDEO_CHAPTER_JSON_MAX_BINDS,
} from "./chapterJsonChunking.ts";

// Compatibility bridge (MIG-0650, D-10): old Next caller delegates the
// canonical member-managed chapter projection to server-core.
import { buildVideoMemberManagedChapterRows } from "./memberChapterRows.ts";

// Compatibility bridge (MIG-0650, D-10): chapter diff/audit semantics shared with Hono.
import { managedChapterRowsEqual } from "./memberChapterAudit.ts";
import { buildVideoMemberWriteAudits } from "./memberWriteAudits.ts";

// Compatibility bridge (MIG-0650, D-10): CURRENT authenticated Next
// caller and future Hono use the same fail-closed X alias resolution.
import { canonicalizeVideoMemberInputs } from "./memberCanonicalization.ts";

// Compatibility bridge (MIG-0650, D-10): canonical identity lookup stays in
// CURRENT, while the exact permission/hidden-row selection is shared with Hono.
import { selectVideoMemberPermissionCarry } from "./memberPermissionCarry.ts";

// Compatibility bridge (MIG-0650, D-10): projection remains deterministic
// after caller completes fail-closed canonical X identity lookup.
import { buildVideoMemberReplacementRows } from "./memberReplacementRows.ts";

// Compatibility bridge (MIG-0650, D-10): shared mutation sequencing
// retains CURRENT member-set CAS and all D1 changes() assertions.
import { buildVideoMemberWriteMutationBatch } from "./memberWriteMutationBatch.ts";

export async function buildReplaceVideoMembersPlan(
  db: ServerCoreDb,
  args: {
    videoId: string;
    members: MemberInput[];
    chaptersByIndex?: Map<number, ParsedMemberChapter[]>;
    actorUserId: string;
  },
): Promise<VideoAtomicWritePlan> {
  if (args.members.length > MAX_VIDEO_MEMBERS) {
    throw new Error("video_member_limit_exceeded");
  }
  const canonicalized = await canonicalizeVideoMemberInputs(db, args.members);
  const members = canonicalized.members;
  const canonicalIdentity = (raw: string | null | undefined): string => {
    const normalized = normalizeXId(raw);
    return normalized
      ? (canonicalized.canonicalByXId.get(normalized) ?? normalized)
      : "";
  };

  const existing = await db
    .select()
    .from(videoMembers)
    .where(
      and(
        eq(videoMembers.video_id, args.videoId),
        eq(videoMembers.is_public_member, 1),
      )!,
    )
    .orderBy(asc(videoMembers.order_index), asc(videoMembers.id))
    .limit(MAX_VIDEO_MEMBERS + 1);
  if (existing.length > MAX_VIDEO_MEMBERS) {
    throw new Error("video_member_existing_limit_exceeded");
  }

  const existingMemberIds = existing.map((row) => row.id);
  const existingManagedChapters = existingMemberIds.length > 0
    ? await db
        .select()
        .from(videoChapters)
        .where(
          and(
            eq(videoChapters.video_id, args.videoId),
            sql`EXISTS (
              SELECT 1
              FROM json_each(${JSON.stringify(existingMemberIds)}) AS member_ids
              WHERE instr(
                      ${videoChapters.id},
                      CAST(member_ids.value AS TEXT) || ':legacy:'
                    ) = 1
                 OR instr(
                      ${videoChapters.id},
                      CAST(member_ids.value AS TEXT) || ':member:'
                    ) = 1
            )`,
          )!,
        )
        .orderBy(asc(videoChapters.chapter_time), asc(videoChapters.id))
    : [];

  const xIds = Array.from(
    new Set(
      members
        .map((member) => normalizeXId(member.x_user_id))
        .filter(Boolean),
    ),
  );
  const xIdSet = new Set(xIds);
  const identityLookupXIds = canonicalized.lookupXIds.length > 0
    ? canonicalized.lookupXIds
    : xIds;

  const carryRows =
    identityLookupXIds.length > 0
      ? await db
          .select()
          .from(videoMembers)
          .where(
            and(
              eq(videoMembers.video_id, args.videoId),
              sql`lower(${videoMembers.x_user_id}) IN (
                SELECT lower(CAST(value AS TEXT))
                FROM json_each(${JSON.stringify(identityLookupXIds)})
              )`,
            )!,
          )
          .limit(MAX_VIDEO_MEMBERS * 2 + 1)
      : [];
  if (carryRows.length > MAX_VIDEO_MEMBERS * 2) {
    throw new Error("video_member_carry_limit_exceeded");
  }

  const { hiddenCarryRows, permissionCarryByXId } =
    selectVideoMemberPermissionCarry(carryRows, xIdSet, canonicalIdentity);

  const existingXUsers =
    xIds.length > 0
      ? await db
          .select({ id: xUsers.id })
          .from(xUsers)
          .where(sql`lower(${xUsers.id}) IN (
            SELECT lower(CAST(value AS TEXT))
            FROM json_each(${JSON.stringify(xIds)})
          )`)
      : [];
  const existingXIds = new Set(existingXUsers.map((row) => normalizeXId(row.id)));

  const { newXUsers, nextMembers } = buildVideoMemberReplacementRows({
    videoId: args.videoId,
    members,
    existingPublic: existing,
    permissionCarryByXId,
    existingXIds,
    canonicalIdentity,
    normalizeXId,
    generateMemberId: () => generateId("vm"),
  });

  const beforeSnapshot = buildVideoMemberSetSnapshot(args.videoId, existing);
  const afterSnapshot = buildVideoMemberSetSnapshot(args.videoId, nextMembers);
  const membersChanged =
    JSON.stringify(beforeSnapshot.rows) !== JSON.stringify(afterSnapshot.rows);

  const nextManagedChapters = buildVideoMemberManagedChapterRows({
    videoId: args.videoId,
    existingManagedChapters,
    nextMembers,
    chaptersByIndex: args.chaptersByIndex,
  });
  const chaptersChanged = !managedChapterRowsEqual(
    existingManagedChapters,
    nextManagedChapters,
  );

  const plan = emptyVideoAtomicWritePlan();
  if (
    !membersChanged &&
    !chaptersChanged &&
    newXUsers.length === 0 &&
    hiddenCarryRows.length === 0
  ) return plan;

  // MIG-0650 U03d-2k: same ordered member/chapter D1 statements and
  // exact change counts are shared with the future Hono writer. CURRENT owns
  // validation, strict audits, one-batch execution and post-commit Queue.
  const mutationBatch = buildVideoMemberWriteMutationBatch(db, {
    videoId: args.videoId,
    beforeSnapshotRows: beforeSnapshot.rows,
    afterSnapshotRows: afterSnapshot.rows,
    existingPublicCount: existing.length,
    hiddenCarryRows,
    newXUsers,
    existingManagedChapters,
    nextManagedChapters,
    membersChanged,
    chaptersChanged,
  });
  plan.statements.push(...mutationBatch.statements);
  plan.expectedChanges.push(...mutationBatch.expectedChanges);

  // Shared CURRENT strict audits. Next still executes one atomic CAS/audit/Queue plan.
  plan.audits.push(...buildVideoMemberWriteAudits({
    videoId: args.videoId, actorUserId: args.actorUserId,
    newXUsers, hiddenCarryRows, chaptersChanged,
    existingManagedChapters, nextManagedChapters, membersChanged,
    beforeSnapshot, afterSnapshot,
  }));

  return plan;
}
