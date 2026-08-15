import { and, asc, eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { videoChapters, videoMembers } from "@/lib/db/schema";
import { formatMemberChapterTime } from "@/lib/video/memberInput";
import type { MemberInput } from "@/lib/video/memberInputs";
import { normalizeMemberChapters } from "@/lib/video/memberInputs";
import { MAX_VIDEO_MEMBERS } from "@/lib/video/atomicLimits";
import { extractVideoMemberIdFromChapterId } from "@/lib/video/memberChapterProjection";
import type { MemberSubmissionBaseline } from "@/lib/video/memberSubmissionCompare";
export {
  remapMemberChaptersByIdentity,
  type MemberChapterIdentityRemap,
} from "./memberChapterIdentity.ts";

export type { MemberSubmissionBaseline } from "@/lib/video/memberSubmissionCompare";
export {
  memberChaptersPayloadChanged,
  memberListPayloadChanged,
  memberSubmissionPayloadChanged,
} from "@/lib/video/memberSubmissionCompare";

export async function loadMemberSubmissionBaseline(
  db: DB,
  videoId: string,
): Promise<MemberSubmissionBaseline> {
  const existing = await db
    .select()
    .from(videoMembers)
    .where(
      and(
        eq(videoMembers.video_id, videoId),
        eq(videoMembers.is_public_member, 1),
      )!,
    )
    .orderBy(asc(videoMembers.order_index), asc(videoMembers.id))
    .limit(MAX_VIDEO_MEMBERS + 1);

  const existingMemberIds = existing.map((row) => row.id);
  const existingManagedChapters =
    existingMemberIds.length > 0
      ? (
          await db
            .select()
            .from(videoChapters)
            .where(
              and(
                eq(videoChapters.video_id, videoId),
                sql`EXISTS (
                  SELECT 1
                  FROM json_each(${JSON.stringify(existingMemberIds)}) AS member_ids
                  WHERE ${videoChapters.id} LIKE
                    CAST(member_ids.value AS TEXT) || ':legacy:%'
                    OR ${videoChapters.id} LIKE
                    CAST(member_ids.value AS TEXT) || ':member:%'
                )`,
              )!,
            )
            .orderBy(asc(videoChapters.chapter_time), asc(videoChapters.id))
        )
      : [];

  const chaptersByMemberId = new Map<string, typeof existingManagedChapters>();
  for (const chapter of existingManagedChapters) {
    const memberId = extractVideoMemberIdFromChapterId(chapter.id) ?? "";
    if (!memberId) continue;
    const list = chaptersByMemberId.get(memberId) ?? [];
    list.push(chapter);
    chaptersByMemberId.set(memberId, list);
  }

  const members: MemberInput[] = existing.map((row) => {
    const chapters = (chaptersByMemberId.get(row.id) ?? []).map((chapter) => ({
      time: formatMemberChapterTime(chapter.chapter_time),
      label: chapter.chapter_label,
      note: chapter.note ?? "",
    }));
    return {
      name: row.name,
      x_user_id: row.x_user_id ?? "",
      role: row.role ?? "",
      comment: row.comment ?? "",
      chapters,
    };
  });

  const chaptersByIndex = new Map<number, import("@/lib/video/memberInputs").ParsedMemberChapter[]>();
  for (let index = 0; index < members.length; index++) {
    const normalized = normalizeMemberChapters(members[index]!, index);
    if (!normalized.ok) continue;
    chaptersByIndex.set(index, normalized.chapters);
  }

  return { members, chaptersByIndex };
}
