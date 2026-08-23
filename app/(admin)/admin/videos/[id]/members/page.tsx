import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  videoChapters,
  videoMembers,
  videos as videosTable,
} from "@/lib/db/schema";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminVideoMembersForm } from "@/components/admin/AdminVideoMembersForm";
import { AdminVideoTabs } from "@/components/admin/AdminVideoTabs";
import type { VideoMemberInput } from "@/components/forms/VideoMembersField";
import { formatMemberChapterTime } from "@/lib/video/memberInput";
import { extractVideoMemberIdFromChapterId } from "@/lib/video/memberChapterProjection";
import { MAX_VIDEO_MEMBERS } from "@/lib/video/atomicLimits";

export const metadata: Metadata = { title: "参加者設定" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminVideoMembersPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) notFound();

  const video = (
    await db
      .select({
        id: videosTable.id,
        title: videosTable.title,
        youtube_video_id: videosTable.youtube_video_id,
        collaboration_type: videosTable.collaboration_type,
      })
      .from(videosTable)
      .where(eq(videosTable.id, id))
      .limit(1)
  )[0];
  if (!video) notFound();

  // 参加者設定は公開メンバーだけを編集する。is_public_member=0 は
  // 「編集できる人」専用のhidden editorであり、ここへ混ぜない。
  const memberRows = await db
    .select()
    .from(videoMembers)
    .where(
      and(
        eq(videoMembers.video_id, video.id),
        eq(videoMembers.is_public_member, 1),
      )!,
    )
    .orderBy(videoMembers.order_index, videoMembers.id)
    .limit(MAX_VIDEO_MEMBERS + 1);
  if (memberRows.length > MAX_VIDEO_MEMBERS) notFound();

  // 参加者だけを編集して保存しても既存managed chapterを消さないよう、
  // member rowに紐づくchapter snapshotも初期フォームへ戻す。
  const memberIds = memberRows.map((member) => member.id);
  const chapterRows = memberIds.length > 0
    ? await db
        .select()
        .from(videoChapters)
        .where(
          and(
            eq(videoChapters.video_id, video.id),
            sql`EXISTS (
              SELECT 1
              FROM json_each(${JSON.stringify(memberIds)}) AS member_ids
              WHERE ${videoChapters.id} LIKE CAST(member_ids.value AS TEXT) || ':legacy:%'
                 OR ${videoChapters.id} LIKE CAST(member_ids.value AS TEXT) || ':member:%'
            )`,
          )!,
        )
        .orderBy(videoChapters.chapter_time, videoChapters.id)
    : [];
  const chaptersByMemberId = new Map<string, typeof chapterRows>();
  for (const chapter of chapterRows) {
    const memberId = extractVideoMemberIdFromChapterId(chapter.id);
    if (!memberId) continue;
    const current = chaptersByMemberId.get(memberId) ?? [];
    current.push(chapter);
    chaptersByMemberId.set(memberId, current);
  }

  const initialMembers: VideoMemberInput[] = memberRows.map((member) => ({
    name: member.name,
    x_user_id: member.x_user_id ?? "",
    role: member.role ?? "",
    comment: member.comment ?? "",
    order_index: member.order_index,
    can_edit: member.can_edit,
    is_public_member: member.is_public_member,
    chapters: (chaptersByMemberId.get(member.id) ?? []).map((chapter) => ({
      time: formatMemberChapterTime(chapter.chapter_time),
      label: chapter.chapter_label,
      note: chapter.note ?? "",
    })),
  }));

  // autocomplete候補はR2静的index経由の /api/internal/x-users/search から取得する。
  // D1からの大量preload（旧 limit(2000)）は撤去済み。

  return (
    <div>
      <AdminPageHeader
        title={`${video.title} の参加者設定`}
        description="公開参加者と合作設定を管理します。既存のメンバーチャプターも保持したまま保存します。"
        backHref={`/admin/videos/${video.id}`}
        backLabel="作品詳細へ"
      />
      <AdminVideoTabs
        videoId={video.id}
        youtubeVideoId={video.youtube_video_id}
        active="members"
      />
      <div style={{ marginTop: 22 }}>
        <AdminVideoMembersForm
          video={video}
          initialMembers={initialMembers}
        />
      </div>
    </div>
  );
}
