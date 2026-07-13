"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { writeGuard } from "@/lib/auth/writeGuard";
import { getDatabase } from "@/lib/cloudflare";
import { videos } from "@/lib/db/schema";
import { buildReplaceVideoMembersPlan } from "@/lib/video/replaceVideoMembers";
import { validateVideoMemberSubmission } from "@/lib/video/submissionValidation";
import type { VideoActionResult } from "@/lib/video/types";
import { expectedRowCondition } from "@/lib/audit/adapters";
import {
  appendVideoAtomicWritePlan,
  emptyVideoAtomicWritePlan,
  executeVideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";

function formDataBoolean(formData: FormData, name: string): boolean {
  return formData
    .getAll(name)
    .some((value) => value === "on" || value === "true");
}

export async function updateVideoMembersAdmin(
  formData: FormData,
): Promise<VideoActionResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
  const user = guard.user;
  if (user.role !== "admin") {
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

  const after = { ...target, collaboration_type: nextCollaborationType, updated_at: now };
  const plan = emptyVideoAtomicWritePlan();
  plan.statements.push(db.update(videos).set({
    collaboration_type: nextCollaborationType,
    updated_at: now,
  }).where(and(
    eq(videos.id, videoId),
    expectedRowCondition({ expectedCurrent: target }),
  )!));
  plan.expectedChanges.push(1);
  plan.audits.push({
    table_name: "videos", target_id: videoId, operation: "UPDATE",
    before: { ...target }, after, actor_user_id: user.id,
    context: "admin-video-members", retention_class: "normal", strict: true,
  });
  appendVideoAtomicWritePlan(plan, await buildReplaceVideoMembersPlan(db, {
    videoId,
    members,
    chaptersByIndex: memberValidation.value.chaptersByIndex,
    actorUserId: user.id,
  }));
  const queue = await buildStaticRebuildQueueBatch(db, [
    { targetType: "video", targetId: videoId, reason: "video_members_update", requestedByUserId: user.id },
    { targetType: "search_index", targetId: "global", reason: "video_members_update", priority: "low" },
    ...(target.creator_x_user_id ? [{ targetType: "user" as const, targetId: target.creator_x_user_id, reason: "video_members_update" }] : []),
    ...(target.primary_event_id ? [{ targetType: "event" as const, targetId: target.primary_event_id, reason: "video_members_update" }] : []),
  ]);
  plan.statements.push(...queue.statements);
  plan.expectedChanges.push(...queue.expectedChanges);
  try {
    await executeVideoAtomicWritePlan(db, plan);
  } catch (error) {
    console.warn("[updateVideoMembersAdmin] atomic save rejected", error);
    return { ok: false, message: "保存が競合しました。再読み込みして再試行してください。" };
  }

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
