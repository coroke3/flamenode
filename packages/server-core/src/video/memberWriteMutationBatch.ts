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
