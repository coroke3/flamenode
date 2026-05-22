import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  videoMemberChapters,
  videoMembers,
  videos as videosTable,
  xUsers,
} from "@/lib/db/schema";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminVideoMembersForm } from "@/components/admin/AdminVideoMembersForm";
import type {
  VideoMemberInput,
  VideoMemberSuggestion,
} from "@/components/forms/VideoMembersField";

export const metadata: Metadata = { title: "参加者設定" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

function formatChapterTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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
        submission_type: videosTable.submission_type,
      })
      .from(videosTable)
      .where(eq(videosTable.id, id))
      .limit(1)
  )[0];
  if (!video) notFound();

  const memberRows = await db
    .select({
      id: videoMembers.id,
      name: videoMembers.name,
      x_user_id: videoMembers.x_user_id,
      role: videoMembers.role,
      comment: videoMembers.comment,
      order_index: videoMembers.order_index,
    })
    .from(videoMembers)
    .where(eq(videoMembers.video_id, video.id))
    .orderBy(videoMembers.order_index, videoMembers.name);

  const memberIds = memberRows.map((m) => m.id);
  const chapterRows =
    memberIds.length > 0
      ? await db
          .select({
            video_member_id: videoMemberChapters.video_member_id,
            chapter_time: videoMemberChapters.chapter_time,
            chapter_label: videoMemberChapters.chapter_label,
            note: videoMemberChapters.note,
            order_index: videoMemberChapters.order_index,
          })
          .from(videoMemberChapters)
          .where(inArray(videoMemberChapters.video_member_id, memberIds))
          .orderBy(
            videoMemberChapters.video_member_id,
            videoMemberChapters.order_index,
            videoMemberChapters.chapter_time,
          )
      : [];

  const chaptersByMember = new Map<string, VideoMemberInput["chapters"]>();
  for (const chapter of chapterRows) {
    const rows = chaptersByMember.get(chapter.video_member_id) ?? [];
    rows.push({
      time: formatChapterTime(Number(chapter.chapter_time)),
      label: chapter.chapter_label,
      note: chapter.note ?? "",
    });
    chaptersByMember.set(chapter.video_member_id, rows);
  }

  const initialMembers: VideoMemberInput[] = memberRows.map((member) => ({
    name: member.name,
    x_user_id: member.x_user_id ?? "",
    role: member.role ?? "",
    comment: member.comment ?? "",
    chapters: chaptersByMember.get(member.id) ?? [],
  }));

  const suggestionRows = await db
    .select({
      name: xUsers.x_name,
      x_user_id: xUsers.id,
    })
    .from(xUsers)
    .orderBy(xUsers.id)
    .limit(2000);
  const memberSuggestions: VideoMemberSuggestion[] = suggestionRows.map((x) => ({
    name: x.name,
    x_user_id: x.x_user_id,
  }));

  return (
    <div>
      <AdminPageHeader
        title={`${video.title} の参加者設定`}
        description="公開参加者、合作フラグ、メンバーチャプターを管理します。"
        backHref={`/admin/videos/${video.id}`}
        backLabel="作品詳細へ"
      />
      <div style={{ marginTop: 22 }}>
        <AdminVideoMembersForm
          video={video}
          initialMembers={initialMembers}
          memberSuggestions={memberSuggestions}
        />
      </div>
    </div>
  );
}
