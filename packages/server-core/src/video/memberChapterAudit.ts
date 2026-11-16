/**
 * MIG-0650 U03d-2b: CURRENT SA-085 managed member-chapter delta and audit
 * summary. Moved byte-for-byte in semantics, without touching D1.
 * Next and future Hono writes consume exactly these pure functions.
 */
import { videoChapters } from "@flamenode/db/schema";
import { compareSqliteBinaryText } from "./memberSetSnapshot.ts";

type ManagedChapterRow = typeof videoChapters.$inferSelect;

function canonicalChapterRows(
  rows: readonly ManagedChapterRow[],
): ManagedChapterRow[] {
  return [...rows].sort((left, right) =>
    compareSqliteBinaryText(left.id, right.id),
  );
}

/**
 * created_at / updated_at はchapter内容の同値判定に含めない。
 * DB readはchapter_time,id順、新規配列はmember順なので入力順を比較すると偽変更になる。
 */
export function managedChapterRowsEqual(
  leftRows: readonly ManagedChapterRow[],
  rightRows: readonly ManagedChapterRow[],
): boolean {
  if (leftRows.length !== rightRows.length) return false;
  const left = canonicalChapterRows(leftRows);
  const right = canonicalChapterRows(rightRows);
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (
      a.id !== b.id ||
      a.video_id !== b.video_id ||
      a.x_user_id !== b.x_user_id ||
      a.chapter_time !== b.chapter_time ||
      a.chapter_label !== b.chapter_label ||
      a.note !== b.note ||
      a.visibility !== b.visibility
    ) {
      return false;
    }
  }
  return true;
}

export function buildChapterAuditSummary(
  videoId: string,
  rows: readonly ManagedChapterRow[],
): Record<string, unknown> {
  const memberIds = new Set<string>();
  let minTime: number | null = null;
  let maxTime: number | null = null;
  let noteCount = 0;
  for (const row of rows) {
    if (row.x_user_id) memberIds.add(row.x_user_id);
    minTime = minTime === null ? row.chapter_time : Math.min(minTime, row.chapter_time);
    maxTime = maxTime === null ? row.chapter_time : Math.max(maxTime, row.chapter_time);
    if (row.note) noteCount += 1;
  }
  return {
    id: videoId,
    row_count: rows.length,
    member_count: memberIds.size,
    min_time: minTime,
    max_time: maxTime,
    note_count: noteCount,
  };
}

