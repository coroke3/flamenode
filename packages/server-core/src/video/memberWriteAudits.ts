/** MIG-0650 U03m: SA-085 pure CURRENT strict audit builder, shared by Next/Hono.
 * This function never executes a DB statement: the authenticated caller must
 * commit these entries with CAS, all member/chapter DML and rebuild queue atomically.
 */
import type { videoMembers, videoChapters, xUsers } from "@flamenode/db/schema";
import type { WriteAuditLogInput } from "../audit/types.ts";
import { toVideoMemberSnapshotRow, type VideoMemberSetSnapshot } from "./memberSetSnapshot.ts";
import { buildChapterAuditSummary } from "./memberChapterAudit.ts";
type MemberRow = typeof videoMembers.$inferSelect;
type ChapterRow = typeof videoChapters.$inferSelect;
type NewXUserRow = typeof xUsers.$inferInsert;

export function buildVideoMemberWriteAudits(input: {
  videoId: string;
  actorUserId: string;
  newXUsers: readonly NewXUserRow[];
  hiddenCarryRows: readonly MemberRow[];
  chaptersChanged: boolean;
  existingManagedChapters: readonly ChapterRow[];
  nextManagedChapters: readonly ChapterRow[];
  membersChanged: boolean;
  beforeSnapshot: VideoMemberSetSnapshot;
  afterSnapshot: VideoMemberSetSnapshot;
}): WriteAuditLogInput[] {
  const {
    videoId, actorUserId, newXUsers, hiddenCarryRows, chaptersChanged,
    existingManagedChapters, nextManagedChapters, membersChanged,
    beforeSnapshot, afterSnapshot,
  } = input;
  const audits: WriteAuditLogInput[] = [];
  if (newXUsers.length > 0) {
    audits.push({
      table_name: "x_users_member_batch",
      target_id: videoId,
      operation: "MERGE",
      before: null,
      after: { id: videoId, rows: newXUsers },
      actor_user_id: actorUserId,
      context: "video-save:member-profile",
      reason: "参加者X IDプロフィール行をpendingで一括確保",
      retention_class: "long_audit",
      restore_strategy: "none",
      strict: true,
    });
  }

  if (hiddenCarryRows.length > 0) {
    audits.push({
      table_name: "video_member_hidden_carry_cleanup",
      target_id: videoId,
      operation: "DELETE",
      before: {
        id: videoId,
        rows: hiddenCarryRows.map(toVideoMemberSnapshotRow),
      },
      after: { id: videoId, rows: [] },
      actor_user_id: actorUserId,
      context: "video-save:members",
      reason: "公開メンバー化したX IDのhidden editorを公開行へ統合",
      retention_class: "long_audit",
      restore_strategy: "none",
      strict: true,
    });
  }

  if (chaptersChanged) {
    audits.push({
      table_name: "video_chapters_member_set",
      target_id: videoId,
      operation: "MERGE",
      before: buildChapterAuditSummary(videoId, existingManagedChapters),
      after: buildChapterAuditSummary(videoId, nextManagedChapters),
      actor_user_id: actorUserId,
      context: "video-save:member-chapters",
      reason: "管理チャプター集合を更新（CPU/D1負荷抑制のため監査は集約情報のみ保持）",
      retention_class: "long_audit",
      // video_chapters_member_set のrestore adapterは存在しないため、復元可能と誤表示しない。
      restore_strategy: "none",
      strict: true,
    });
  }

  if (membersChanged) {
    audits.push({
      table_name: "video_members_set",
      target_id: videoId,
      operation: "MERGE",
      before: beforeSnapshot,
      after: afterSnapshot,
      actor_user_id: actorUserId,
      context: "video-save:members",
      retention_class: "restorable",
      restore_strategy: "custom_adapter",
      strict: true,
    });
  }
  return audits;
}
