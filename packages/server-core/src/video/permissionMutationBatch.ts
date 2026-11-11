import type { videoMembers } from "@flamenode/db/schema";
import type { BatchItem } from "drizzle-orm/batch";
import type { ServerCoreDb } from "../db.ts";
import { buildVideoMemberBulkInsertSql, toVideoMemberSnapshotRow } from "./memberSetSnapshot.ts";
import type { planVideoPermissionChanges } from "./permissionPlan.ts";
import {
  buildHiddenEditorCountGuardSql,
  buildHiddenMemberBulkDeleteSql,
  buildMemberPermissionBulkUpdateSql,
  buildPermissionSetGuardSql,
  buildXUsersBulkInsertSql,
} from "./permissionSql.ts";

type VideoMemberRow = typeof videoMembers.$inferSelect;

/**
 * SA-082..084 exact CURRENT permission D1 mutation phase, BEFORE audit/outbox
 * and static rebuild statements are appended. Never execute these promises
 * independently: the caller must submit all in ONE strict atomic audit batch.
 *
 * The two CAS assertions are ordered before every DML statement. The X profile
 * upsert's expectedChanges is exact: a concurrent rejection yields zero rows
 * and aborts the entire batch, while a concurrent valid pending/approved row
 * remains idempotently writable. A null expectation is only for CAS reads.
 */
export function buildPermissionMutationBatch(
  db: ServerCoreDb,
  input: {
    videoId: string;
    xids: readonly string[];
    existingRows: readonly VideoMemberRow[];
    currentHiddenEditorCount: number;
    plan: ReturnType<typeof planVideoPermissionChanges>;
  },
): {
  statements: BatchItem<"sqlite">[];
  expectedChanges: Array<number | null>;
} {
  const { videoId, xids, existingRows, currentHiddenEditorCount, plan } = input;
  const statements: BatchItem<"sqlite">[] = [];
  const expectedChanges: Array<number | null> = [];
  statements.push(db.run(buildPermissionSetGuardSql(videoId, xids, existingRows)));
  expectedChanges.push(null);
  if (plan.insertHiddenRows.length > 0 || plan.deleteHiddenIds.length > 0) {
    statements.push(db.run(buildHiddenEditorCountGuardSql(videoId, currentHiddenEditorCount)));
    expectedChanges.push(null);
  }
  if (plan.newXUsers.length > 0) {
    statements.push(db.run(buildXUsersBulkInsertSql(plan.newXUsers)));
    expectedChanges.push(plan.newXUsers.length);
  }
  if (plan.updateRows.length > 0) {
    statements.push(db.run(buildMemberPermissionBulkUpdateSql(plan.updateRows)));
    expectedChanges.push(plan.updateRows.length);
  }
  if (plan.insertHiddenRows.length > 0) {
    statements.push(db.run(buildVideoMemberBulkInsertSql(
      plan.insertHiddenRows.map(toVideoMemberSnapshotRow),
    )));
    expectedChanges.push(plan.insertHiddenRows.length);
  }
  if (plan.deleteHiddenIds.length > 0) {
    statements.push(db.run(buildHiddenMemberBulkDeleteSql(videoId, plan.deleteHiddenIds)));
    expectedChanges.push(plan.deleteHiddenIds.length);
  }
  return { statements, expectedChanges };
}
