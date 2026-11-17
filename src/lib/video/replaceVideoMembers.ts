import { and, asc, eq, sql } from "drizzle-orm";
import { videoChapters, videoMembers, xUsers } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "#utils/xid";
import type { MemberInput, ParsedMemberChapter } from "@/lib/video/memberInputs";
import {
  emptyVideoAtomicWritePlan,
  type VideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { MAX_VIDEO_MEMBERS } from "@/lib/video/atomicLimits";
import {
  buildVideoMemberBulkInsertSql,
  buildVideoMemberSetGuardSql,
  buildVideoMemberSetSnapshot,
  toVideoMemberSnapshotRow,
} from "@/lib/video/memberSetSnapshot";

// Compatibility bridge (MIG-0650, D-10): SA-085 JSON1 chunking is shared with Hono.
export {
  chunkRowsByJsonByteSize,
  jsonUtf8ByteLength,
  VIDEO_CHAPTER_JSON_MAX_BYTES,
  VIDEO_CHAPTER_JSON_MAX_BINDS,
} from "@flamenode/server-core/video/chapterJsonChunking";

// Compatibility bridge (MIG-0650, D-10): original SQL compound statements live in server-core.
import {
  buildVideoChapterBulkDeleteSql,
  buildVideoChapterBulkInsertSql,
} from "@flamenode/server-core/video/memberChapterSql";

// Compatibility bridge (MIG-0650, D-10): old Next caller delegates the
// canonical member-managed chapter projection to server-core.
import { buildVideoMemberManagedChapterRows } from "@flamenode/server-core/video/memberChapterRows";

// Compatibility bridge (MIG-0650, D-10): chapter diff/audit semantics shared with Hono.
import {
  managedChapterRowsEqual,
  buildChapterAuditSummary,
} from "@flamenode/server-core/video/memberChapterAudit";

// Compatibility bridge (MIG-0650, D-10): CURRENT authenticated Next
// caller and future Hono use the same fail-closed X alias resolution.
import { canonicalizeVideoMemberInputs } from "@flamenode/server-core/video/memberCanonicalization";

// Compatibility bridge (MIG-0650, D-10): canonical identity lookup stays in
// CURRENT, while the exact permission/hidden-row selection is shared with Hono.
import { selectVideoMemberPermissionCarry } from "@flamenode/server-core/video/memberPermissionCarry";

// Compatibility bridge (MIG-0650, D-10): projection remains deterministic
// after caller completes fail-closed canonical X identity lookup.
import { buildVideoMemberReplacementRows } from "@flamenode/server-core/video/memberReplacementRows";

// Compatibility bridge (MIG-0650, D-10): CURRENT X-user pending
// UPSERT SQL is shared without changing the atomic batch/audit callers.
import { buildVideoMemberXUserBatchSql } from "@flamenode/server-core/video/memberXUserSql";

// Compatibility bridge (MIG-0650, D-10): hidden carry CAS/delete SQL lives in core.
import {
  buildHiddenCarryRowsGuardSql,
  buildHiddenCarryRowsDeleteSql,
} from "@flamenode/server-core/video/hiddenMemberCarrySql";

export async function buildReplaceVideoMembersPlan(
  db: DB,
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

  plan.statements.push(
    db.run(buildVideoMemberSetGuardSql(args.videoId, beforeSnapshot.rows)),
  );
  plan.expectedChanges.push(null);

  if (hiddenCarryRows.length > 0) {
    plan.statements.push(
      db.run(buildHiddenCarryRowsGuardSql(args.videoId, hiddenCarryRows)),
    );
    plan.expectedChanges.push(null);
  }

  if (newXUsers.length > 0) {
    plan.statements.push(db.run(buildVideoMemberXUserBatchSql(newXUsers)));
    // SELECT後に別requestが同じX IDを作っていても、同一IDのno-op UPDATEを
    // 1 changeとして扱い、参加者保存全体を不要なUNIQUE競合で落とさない。
    plan.expectedChanges.push(newXUsers.length);
    plan.audits.push({
      table_name: "x_users_member_batch",
      target_id: args.videoId,
      operation: "MERGE",
      before: null,
      after: { id: args.videoId, rows: newXUsers },
      actor_user_id: args.actorUserId,
      context: "video-save:member-profile",
      reason: "参加者X IDプロフィール行をpendingで一括確保",
      retention_class: "long_audit",
      restore_strategy: "none",
      strict: true,
    });
  }

  if (hiddenCarryRows.length > 0) {
    plan.statements.push(
      db.run(buildHiddenCarryRowsDeleteSql(args.videoId, hiddenCarryRows)),
    );
    plan.expectedChanges.push(hiddenCarryRows.length);
    plan.audits.push({
      table_name: "video_member_hidden_carry_cleanup",
      target_id: args.videoId,
      operation: "DELETE",
      before: {
        id: args.videoId,
        rows: hiddenCarryRows.map(toVideoMemberSnapshotRow),
      },
      after: { id: args.videoId, rows: [] },
      actor_user_id: args.actorUserId,
      context: "video-save:members",
      reason: "公開メンバー化したX IDのhidden editorを公開行へ統合",
      retention_class: "long_audit",
      restore_strategy: "none",
      strict: true,
    });
  }

  // チャプターだけ変更した保存では公開メンバー集合をDELETE/INSERTし直さない。
  // 不要なD1 writeと権限metadataの再書込みを避け、member-set CASだけを競合ガードに使う。
  if (membersChanged && existing.length > 0) {
    plan.statements.push(
      db
        .delete(videoMembers)
        .where(
          and(
            eq(videoMembers.video_id, args.videoId),
            eq(videoMembers.is_public_member, 1),
          )!,
        ),
    );
    plan.expectedChanges.push(existing.length);
  }

  if (membersChanged && afterSnapshot.rows.length > 0) {
    plan.statements.push(
      db.run(buildVideoMemberBulkInsertSql(afterSnapshot.rows)),
    );
    plan.expectedChanges.push(afterSnapshot.rows.length);
  }

  if (chaptersChanged && existingManagedChapters.length > 0) {
    for (const chunk of buildVideoChapterBulkDeleteSql(
      args.videoId,
      existingManagedChapters,
    )) {
      plan.statements.push(db.run(chunk.statement));
      plan.expectedChanges.push(chunk.rowCount);
    }
  }
  if (chaptersChanged && nextManagedChapters.length > 0) {
    for (const chunk of buildVideoChapterBulkInsertSql(nextManagedChapters)) {
      plan.statements.push(db.run(chunk.statement));
      plan.expectedChanges.push(chunk.rowCount);
    }
  }
  if (chaptersChanged) {
    plan.audits.push({
      table_name: "video_chapters_member_set",
      target_id: args.videoId,
      operation: "MERGE",
      before: buildChapterAuditSummary(args.videoId, existingManagedChapters),
      after: buildChapterAuditSummary(args.videoId, nextManagedChapters),
      actor_user_id: args.actorUserId,
      context: "video-save:member-chapters",
      reason: "管理チャプター集合を更新（CPU/D1負荷抑制のため監査は集約情報のみ保持）",
      retention_class: "long_audit",
      // video_chapters_member_set のrestore adapterは存在しないため、復元可能と誤表示しない。
      restore_strategy: "none",
      strict: true,
    });
  }

  if (membersChanged) {
    plan.audits.push({
      table_name: "video_members_set",
      target_id: args.videoId,
      operation: "MERGE",
      before: beforeSnapshot,
      after: afterSnapshot,
      actor_user_id: args.actorUserId,
      context: "video-save:members",
      retention_class: "restorable",
      restore_strategy: "custom_adapter",
      strict: true,
    });
  }

  return plan;
}
