export type MemberChapterSource = {
  id: string;
  chapter_time: number;
  chapter_label: string;
  note: string | null;
};

export type ProjectedMemberChapter =
  MemberChapterSource & {
    video_member_id: string;
    order_index: number;
  };

export function
extractVideoMemberIdFromChapterId(
  chapterId: string,
): string | null {
  const id = chapterId.trim();
  if (!id) return null;

  const memberIndex =
    id.indexOf(":member:");
  const legacyIndex =
    id.indexOf(":legacy:");

  const indexes = [
    memberIndex,
    legacyIndex,
  ].filter((index) => index > 0);

  if (indexes.length === 0) {
    return null;
  }

  const markerIndex =
    Math.min(...indexes);

  const memberId =
    id.slice(0, markerIndex).trim();

  return memberId || null;
}

export function
projectMemberChapters(args: {
  chapters:
    readonly MemberChapterSource[];
  publicMemberIds:
    ReadonlySet<string>;
}): ProjectedMemberChapter[] {
  const result:
    ProjectedMemberChapter[] = [];

  for (const chapter of args.chapters) {
    const memberId =
      extractVideoMemberIdFromChapterId(
        chapter.id,
      );

    if (
      !memberId ||
      !args.publicMemberIds.has(
        memberId,
      )
    ) {
      continue;
    }

    result.push({
      ...chapter,
      video_member_id:
        memberId,
      order_index:
        result.length,
    });
  }

  return result.sort(
    (left, right) =>
      left.chapter_time -
        right.chapter_time ||
      left.order_index -
        right.order_index ||
      left.id.localeCompare(
        right.id,
      ),
  );
}
