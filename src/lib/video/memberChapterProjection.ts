import { normalizeXId } from "../utils/xid.ts";

export type MemberChapterSource = {
  id: string;
  x_user_id?: string | null;
  chapter_time: number;
  chapter_label: string;
  note: string | null;
};

export type PublicMemberChapterSource = {
  id: string;
  x_user_id: string | null;
};

export type ProjectedMemberChapter = MemberChapterSource & {
  video_member_id: string;
  order_index: number;
};

export function extractVideoMemberIdFromChapterId(
  chapterId: string,
): string | null {
  const id = chapterId.trim();
  if (!id) return null;

  const memberIndex = id.indexOf(":member:");
  const legacyIndex = id.indexOf(":legacy:");

  const indexes = [memberIndex, legacyIndex].filter((index) => index > 0);

  if (indexes.length === 0) {
    return null;
  }

  const markerIndex = Math.min(...indexes);
  const memberId = id.slice(0, markerIndex).trim();

  return memberId || null;
}

function resolveProjectedMemberId(args: {
  chapter: MemberChapterSource;
  publicMembers: readonly PublicMemberChapterSource[];
  publicMemberIds: ReadonlySet<string>;
}): string | null {
  const explicitMemberId = extractVideoMemberIdFromChapterId(args.chapter.id);

  if (explicitMemberId && args.publicMemberIds.has(explicitMemberId)) {
    return explicitMemberId;
  }

  const chapterXId = normalizeXId(args.chapter.x_user_id ?? "");
  if (!chapterXId) return null;

  const matches = args.publicMembers.filter(
    (member) => normalizeXId(member.x_user_id ?? "") === chapterXId,
  );

  return matches.length === 1 ? matches[0].id : null;
}

export function projectMemberChapters(args: {
  chapters: readonly MemberChapterSource[];
  publicMembers: readonly PublicMemberChapterSource[];
}): ProjectedMemberChapter[] {
  const publicMemberIds = new Set(
    args.publicMembers.map((member) => member.id.trim()).filter(Boolean),
  );

  const result: ProjectedMemberChapter[] = [];

  for (const chapter of args.chapters) {
    const memberId = resolveProjectedMemberId({
      chapter,
      publicMembers: args.publicMembers,
      publicMemberIds,
    });

    if (!memberId) continue;

    result.push({
      ...chapter,
      video_member_id: memberId,
      order_index: result.length,
    });
  }

  return result.sort(
    (left, right) =>
      left.chapter_time - right.chapter_time ||
      left.order_index - right.order_index ||
      left.id.localeCompare(right.id),
  );
}
