import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
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
import { formatChapterTime } from "@/lib/utils/chapterTime";

export const metadata: Metadata = { title: "参加者設定" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

function parseMemberChapters(raw: string | null): VideoMemberInput["chapters"] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const time = Number(row.time_seconds ?? row.time ?? row.chapter_time);
        const label = String(row.label ?? row.chapter_label ?? "").trim();
        if (!Number.isFinite(time)) return null;
        return {
          time: formatChapterTime(time),
          label,
          note: String(row.note ?? ""),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  } catch {
    return [];
  }
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
      id: videoMembers.id,
      name: videoMembers.name,
      x_user_id: videoMembers.x_user_id,
      role: videoMembers.role,
      comment: videoMembers.comment,
      chapters_json: videoMembers.chapters_json,
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
    chapters: parseMemberChapters(member.chapters_json),
    order_index: member.order_index,
    can_edit: member.can_edit,
    is_public_member: member.is_public_member,
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
