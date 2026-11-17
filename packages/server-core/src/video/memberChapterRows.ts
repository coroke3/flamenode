/**
 * MIG-0650 U03d-2h: CURRENT SA-085 member-managed chapter row projection.
 *
 * Pure in database effects; the same timestamp is acquired ONCE for a write
 * projection as the CURRENT Next planner. The caller must already validate
 * chapter time/length and authorize/canonicalize video members.
 * No D1, CAS, auth, queue or audit side effects are performed here.
 */
import type { videoChapters, videoMembers } from "@flamenode/db/schema";

type ManagedChapterRow = typeof videoChapters.$inferSelect;
type MemberRow = typeof videoMembers.$inferSelect;
type ParsedMemberChapter = {
  time_seconds: number;
  label: string;
  note: string;
};

export function buildVideoMemberManagedChapterRows(input: {
  videoId: string;
  existingManagedChapters: readonly ManagedChapterRow[];
  nextMembers: readonly MemberRow[];
  chaptersByIndex?: ReadonlyMap<number, readonly ParsedMemberChapter[]>;
}): ManagedChapterRow[] {
  const { videoId, existingManagedChapters, nextMembers, chaptersByIndex } = input;
  const existingChapterById = new Map(
    existingManagedChapters.map((chapter) => [chapter.id, chapter]),
  );
  const now = Math.floor(Date.now() / 1000);
  const nextManagedChapters: Array<typeof videoChapters.$inferSelect> = [];
  for (const [memberIndex, member] of nextMembers.entries()) {
    const chapters = chaptersByIndex?.get(memberIndex) ?? [];
    for (const [chapterIndex, chapter] of chapters.entries()) {
      const id = `${member.id}:member:${chapterIndex}`;
      nextManagedChapters.push({
        id,
        video_id: videoId,
        x_user_id: member.x_user_id,
        chapter_time: chapter.time_seconds,
        chapter_label: chapter.label,
        note: chapter.note || null,
        visibility: "public",
        created_at: existingChapterById.get(id)?.created_at ?? now,
        updated_at: now,
      });
    }
  }
  return nextManagedChapters;
}
