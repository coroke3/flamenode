import { normalizeXId } from "#utils/xid";
import type { MemberInput, ParsedMemberChapter } from "./memberInputs.ts";

export interface MemberSubmissionBaseline {
  members: MemberInput[];
  chaptersByIndex: Map<number, ParsedMemberChapter[]>;
}

/** メンバー本体のみ（チャプター除外）。chapters-only 編集を members 変更と誤認しない。 */
function memberListComparableSnapshot(members: MemberInput[]): string {
  return JSON.stringify(
    members.map((member) => ({
      name: member.name.trim(),
      x_user_id: normalizeXId(member.x_user_id),
      role: member.role.trim(),
      comment: member.comment.trim(),
    })),
  );
}

function memberComparableSnapshot(members: MemberInput[]): string {
  return JSON.stringify(
    members.map((member) => ({
      name: member.name.trim(),
      x_user_id: normalizeXId(member.x_user_id),
      role: member.role.trim(),
      comment: member.comment.trim(),
      chapters: (member.chapters ?? []).map((chapter) => ({
        time: chapter.time.trim(),
        label: chapter.label.trim(),
        note: chapter.note.trim(),
      })),
    })),
  );
}

function chaptersByIndexSnapshot(chaptersByIndex: Map<number, ParsedMemberChapter[]>): string {
  const rows: Array<{ index: number; chapters: ParsedMemberChapter[] }> = [];
  for (const [index, chapters] of chaptersByIndex.entries()) {
    rows.push({ index, chapters });
  }
  rows.sort((left, right) => left.index - right.index);
  return JSON.stringify(
    rows.map((row) => ({
      index: row.index,
      chapters: row.chapters.map((chapter) => ({
        time_seconds: chapter.time_seconds,
        label: chapter.label,
        note: chapter.note,
        order_index: chapter.order_index,
      })),
    })),
  );
}

export function memberListPayloadChanged(
  baseline: MemberSubmissionBaseline,
  submitted: MemberSubmissionBaseline,
): boolean {
  return (
    memberListComparableSnapshot(baseline.members) !==
    memberListComparableSnapshot(submitted.members)
  );
}

export function memberSubmissionPayloadChanged(
  baseline: MemberSubmissionBaseline,
  submitted: MemberSubmissionBaseline,
): boolean {
  return (
    memberComparableSnapshot(baseline.members) !==
      memberComparableSnapshot(submitted.members) ||
    chaptersByIndexSnapshot(baseline.chaptersByIndex) !==
      chaptersByIndexSnapshot(submitted.chaptersByIndex)
  );
}

export function memberChaptersPayloadChanged(
  baseline: MemberSubmissionBaseline,
  submitted: MemberSubmissionBaseline,
): boolean {
  return (
    chaptersByIndexSnapshot(baseline.chaptersByIndex) !==
    chaptersByIndexSnapshot(submitted.chaptersByIndex)
  );
}
