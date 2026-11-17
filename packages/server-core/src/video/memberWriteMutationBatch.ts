/**
 * MIG-0650 U03d-2j: SA-085 member/chapter D1 mutation statements in CURRENT
 * order, before audit/outbox/Queue statements are appended by the caller.
 *
 * Every CAS runs inside the SAME host-controlled strict atomic audit batch.
 * Never execute these statements individually. Exact D1 changes() assertions
 * are preserved for X profile conflict no-op UPSERT, hidden member cleanup,
 * public replacement and JSON1 chapter delete/insert.
 *
 * No authorization, network, auditing, wake or DB execution occurs here.
 */
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { videoMembers } from "@flamenode/db/schema";
import type { videoChapters, xUsers } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";
import {
  buildVideoMemberSetGuardSql,
  buildVideoMemberBulkInsertSql,
  type VideoMemberSnapshotRow,
} from "./memberSetSnapshot.ts";
import {
  buildHiddenCarryRowsGuardSql,
  buildHiddenCarryRowsDeleteSql,
} from "./hiddenMemberCarrySql.ts";
import { buildVideoMemberXUserBatchSql } from "./memberXUserSql.ts";
import {
  buildVideoChapterBulkDeleteSql,
  buildVideoChapterBulkInsertSql,
} from "./memberChapterSql.ts";

type MemberRow = typeof videoMembers.$inferSelect;
type ChapterRow = typeof videoChapters.$inferSelect;
type NewXUserRow = typeof xUsers.$inferInsert;

export function buildVideoMemberWriteMutationBatch(
  db: ServerCoreDb,
  input: {
    videoId: string;
    beforeSnapshotRows: readonly VideoMemberSnapshotRow[];
    afterSnapshotRows: readonly VideoMemberSnapshotRow[];
    existingPublicCount: number;
    hiddenCarryRows: readonly MemberRow[];
    newXUsers: readonly NewXUserRow[];
    existingManagedChapters: readonly ChapterRow[];
    nextManagedChapters: readonly ChapterRow[];
    membersChanged: boolean;
    chaptersChanged: boolean;
  },
): { statements: BatchItem<"sqlite">[]; expectedChanges: Array<number | null> } {
  const {
    videoId, beforeSnapshotRows, afterSnapshotRows, existingPublicCount,
    hiddenCarryRows, newXUsers, existingManagedChapters, nextManagedChapters,
    membersChanged, chaptersChanged,
  } = input;
  // All row sets must belong to the video authorized by the caller. In
  // particular, JSON1 bulk inserts bind each row's own video_id, whereas
  // the CAS/deletes are scoped to the outer videoId. A mismatched candidate
  // must never be allowed to plan a cross-video insert or chapter rewrite.
  // Check before constructing even the CAS statement; the caller must not
  // execute a partial or malformed write plan.
  if ([
    beforeSnapshotRows, afterSnapshotRows, hiddenCarryRows,
    existingManagedChapters, nextManagedChapters,
  ].some(rows => rows.some(row => row.video_id !== videoId))) {
    throw new RangeError("video_member_write_cross_video_rows");
  }
  // The member-set CAS and the hidden carry cleanup have distinct scopes.
  // A wrongly classified row could otherwise be inserted as a hidden member
  // by the public replacement query or be omitted from the hidden DELETE.
  // Validate the host's row classifications before any D1 statement is made.
  if (
    beforeSnapshotRows.some(row => row.is_public_member !== 1) ||
    afterSnapshotRows.some(row => row.is_public_member !== 1) ||
    hiddenCarryRows.some(row => row.is_public_member !== 0)
  ) {
    throw new RangeError("video_member_write_public_class_mismatch");
  }
  // The authoritative pre-read count is used as the exact expected DELETE
  // changes() assertion. Only verify it when a public replacement is planned;
  // a chapter-only edit intentionally never rewrites public member rows.
  if (membersChanged && existingPublicCount !== beforeSnapshotRows.length) {
    throw new RangeError("video_member_write_public_count_mismatch");
  }
  // CURRENT derives membersChanged from these canonical snapshot rows.
  // A future Hono adapter must not suppress the public replacement, strict
  // member audit or rebuild queue by passing "unchanged" with different rows.
  // The authorized snapshot is limited to 100 public members by the caller.
  if (!membersChanged &&
      JSON.stringify(beforeSnapshotRows) !== JSON.stringify(afterSnapshotRows)) {
    throw new RangeError("video_member_write_undeclared_member_changes");
  }
  // Exact DELETE/INSERT changes() counts rely on unique IDs in each
  // independently supplied snapshot. D1 primary keys cannot substitute for
  // an authenticated plan preflight: duplicate JSON1 delete IDs are silently
  // deduplicated by IN (...), while duplicate insert IDs can abort an atomic
  // batch only after costly SQL/audit/Queue planning.
  // IDs may legitimately repeat across before/after snapshots (same member),
  // so only check uniqueness *within* each row set.
  const hasDuplicateOrEmptyIds = (rows: readonly { id: string }[]): boolean => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (typeof row.id !== "string" || row.id.length === 0 || ids.has(row.id)) {
        return true;
      }
      ids.add(row.id);
    }
    return false;
  };
  if ([
    beforeSnapshotRows, afterSnapshotRows, hiddenCarryRows, newXUsers,
    existingManagedChapters, nextManagedChapters,
  ].some(hasDuplicateOrEmptyIds)) {
    throw new RangeError("video_member_write_duplicate_or_empty_row_id");
  }
  // This admin-members flow may only reserve a previously unknown X identity
  // as pending. Profile approval is a separate privileged workflow. The JSON1
  // batch INSERT binds approval_status from each supplied row, so relying on
  // the table default would not prevent a future Hono host from accidentally
  // inserting an approved or rejected profile.
  if (newXUsers.some(row => row.approval_status !== "pending")) {
    throw new RangeError("video_member_write_x_profile_not_pending");
  }
  const statements: BatchItem<"sqlite">[] = [];
  const expectedChanges: Array<number | null> = [];

  // The member-set snapshot guard always precedes every mutation.
  statements.push(db.run(buildVideoMemberSetGuardSql(videoId, beforeSnapshotRows)));
  expectedChanges.push(null);

  if (hiddenCarryRows.length > 0) {
    statements.push(db.run(buildHiddenCarryRowsGuardSql(videoId, hiddenCarryRows)));
    expectedChanges.push(null);
  }
  if (newXUsers.length > 0) {
    statements.push(db.run(buildVideoMemberXUserBatchSql(newXUsers)));
    // CURRENT requires one change per X ID even when a concurrent writer
    // inserted the same ID (ON CONFLICT(id) DO UPDATE SET id = excluded.id).
    expectedChanges.push(newXUsers.length);
  }
  if (hiddenCarryRows.length > 0) {
    statements.push(db.run(buildHiddenCarryRowsDeleteSql(videoId, hiddenCarryRows)));
    expectedChanges.push(hiddenCarryRows.length);
  }

  // A chapter-only edit must never delete and reinsert unchanged public members.
  if (membersChanged && existingPublicCount > 0) {
    statements.push(db.delete(videoMembers).where(
      and(
        eq(videoMembers.video_id, videoId),
        eq(videoMembers.is_public_member, 1),
      )!,
    ));
    expectedChanges.push(existingPublicCount);
  }
  if (membersChanged && afterSnapshotRows.length > 0) {
    statements.push(db.run(buildVideoMemberBulkInsertSql(afterSnapshotRows)));
    expectedChanges.push(afterSnapshotRows.length);
  }
  if (chaptersChanged && existingManagedChapters.length > 0) {
    for (const chunk of buildVideoChapterBulkDeleteSql(videoId, existingManagedChapters)) {
      statements.push(db.run(chunk.statement));
      expectedChanges.push(chunk.rowCount);
    }
  }
  if (chaptersChanged && nextManagedChapters.length > 0) {
    for (const chunk of buildVideoChapterBulkInsertSql(nextManagedChapters)) {
      statements.push(db.run(chunk.statement));
      expectedChanges.push(chunk.rowCount);
    }
  }
  return { statements, expectedChanges };
}
