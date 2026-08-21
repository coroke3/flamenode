import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  videoMembers,
  videos as videosTable,
} from "@/lib/db/schema";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminVideoMembersForm } from "@/components/admin/AdminVideoMembersForm";
import { AdminVideoTabs } from "@/components/admin/AdminVideoTabs";
import type { VideoMemberInput } from "@/components/forms/VideoMembersField";

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

  const memberRows = await db
    .select({
      name: videoMembers.name,
      x_user_id: videoMembers.x_user_id,
      role: videoMembers.role,
      comment: videoMembers.comment,
      order_index: videoMembers.order_index,
      can_edit: videoMembers.can_edit,
      is_public_member: videoMembers.is_public_member,
    })
    .from(videoMembers)
    .where(eq(videoMembers.video_id, video.id))
    .orderBy(videoMembers.order_index, videoMembers.name);

  const initialMembers: VideoMemberInput[] = memberRows.map((member) => ({
    name: member.name,
    x_user_id: member.x_user_id ?? "",
    role: member.role ?? "",
    comment: member.comment ?? "",
    order_index: member.order_index,
    can_edit: member.can_edit,
    is_public_member: member.is_public_member,
  }));

  // autocomplete候補はR2静的index経由の /api/internal/x-users/search から取得する。
  // D1からの大量preload（旧 limit(2000)）は撤去済み。

  return (
    <div>
      <AdminPageHeader
        title={`${video.title} の参加者設定`}
        description="公開参加者と合作設定を管理します。チャプターは作品詳細の専用機能で管理します。"
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
