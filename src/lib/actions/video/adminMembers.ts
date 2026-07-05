"use server";

import { auditAction } from "@/lib/audit/helpers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDatabase } from "@/lib/cloudflare";
import { videos } from "@/lib/db/schema";
import { replaceVideoMembers } from "@/lib/video/replaceVideoMembers";
import { validateVideoMemberSubmission } from "@/lib/video/submissionValidation";
import type { VideoActionResult } from "@/lib/video/types";

function formDataBoolean(formData: FormData, name: string): boolean {
  return formData
    .getAll(name)
    .some((value) => value === "on" || value === "true");
}

export async function updateVideoMembersAdmin(
  formData: FormData,
): Promise<VideoActionResult> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return { ok: false, message: "管理者権限が必要です。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const videoId = String(formData.get("video_id") ?? "").trim();
  if (!videoId) return { ok: false, message: "対象作品が指定されていません。" };

  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "作品が見つかりません。" };

  const isCollab = formDataBoolean(formData, "is_collab");
  const memberValidation = validateVideoMemberSubmission(formData, isCollab);
  if (!memberValidation.ok) return memberValidation;

  const members = memberValidation.value.members;
  const nextCollaborationType = members.length > 0 || isCollab ? "collab" : "individual";
  const now = Math.floor(Date.now() / 1000);

  await db
    .update(videos)
    .set({
      collaboration_type: nextCollaborationType,
      updated_at: now,
    })
    .where(eq(videos.id, videoId));
  await replaceVideoMembers(
    db,
    videoId,
    members,
    memberValidation.value.chaptersByIndex,
  );

  await auditAction(db, {
    table_name: "videos",
    record_id: videoId,
    action: "UPDATE",
    before_data: JSON.stringify({
      collaboration_type: target.collaboration_type,
    }),
    after_data: JSON.stringify({
      collaboration_type: nextCollaborationType,
      member_count: members.length,
      source: "admin_video_members",
    }),
    operator_discord_id: user.id,
    retention_class: "normal",
  });

  revalidatePath(`/admin/videos/${videoId}`);
  revalidatePath(`/admin/videos/${videoId}/members`);
  revalidatePath(`/dashboard/edit/${videoId}`);
  revalidatePath(`/${target.youtube_video_id ?? videoId}`);
  revalidatePath("/list");
  if (target.primary_event_id) {
    revalidatePath(`/event/${target.primary_event_id}`);
    revalidatePath(`/event/${target.primary_event_id}/slots`);
  }

  return {
    ok: true,
    message: "参加者設定を保存しました。",
    videoId,
    youtubeVideoId: target.youtube_video_id ?? undefined,
    eventId: target.primary_event_id ?? undefined,
  };
}
