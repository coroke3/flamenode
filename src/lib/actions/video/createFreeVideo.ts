"use server";

import { revalidatePath } from "next/cache";
import { getDatabase } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import { videos } from "@/lib/db/schema";
import { buildReplaceVideoSoftwarePlan } from "@/lib/db/software";
import {
  snapshotYoutubeChannelUrl,
} from "@/lib/db/youtubeChannelCandidates";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { buildFreeVideoSubmittedNotification } from "@/lib/notifications/templates/video";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";
import { extractYoutubeId } from "@/lib/youtube/id";
import {
  appendVideoAtomicWritePlan,
  emptyVideoAtomicWritePlan,
  executeVideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { buildReplaceGeneralCustomAnswersPlan } from "@/lib/video/customQuestionAnswers";
import { buildSubmissionXUserPlan } from "@/lib/video/ensureSubmissionXUser";
import { parseEventIdsFromForm } from "@/lib/video/parseEventIds";
import { buildReplaceVideoMembersPlan } from "@/lib/video/replaceVideoMembers";
import {
  buildStagePermissionSubmission,
  getStagePermissionFieldsForEvents,
} from "@/lib/video/stagePermissionSubmission";
import { buildReplaceStagePermissionAnswersPlan } from "@/lib/video/stagePermissionAnswers";
import {
  validateCustomAnswersForEvents,
  validateVideoMemberSubmission,
} from "@/lib/video/submissionValidation";
import {
  buildSyncVideoEventsPlan,
  buildVideoDerivedRowsPlan,
  MAX_ATOMIC_VIDEO_EVENTS,
  resolveEventSyncTargetForNewVideo,
} from "@/lib/video/syncVideoEvents";
import { checkYoutubeVideoDuplicate } from "@/lib/video/slotPart";
import type { VideoActionResult } from "@/lib/video/types";
import { parseVideoForm } from "@/lib/video/videoFormSchema";
import { isYoutubeIdUniqueConstraintError } from "@/lib/video/youtubeDuplicate";

export async function createFreeVideo(formData: FormData): Promise<VideoActionResult> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "post_video_unslotted",
  });
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
  const sessionUser = guard.user;
  const userId = sessionUser.id;
  const parsed = parseVideoForm(Object.fromEntries(formData));
  if (!parsed.ok) return parsed;
  const youtubeId = extractYoutubeId(parsed.data.youtube_url);
  if (!youtubeId) return { ok: false, message: "YouTube URLを解析できません。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DBに接続できません。" };
  const activeX = normalizeXId(sessionUser.active_x_user_id);
  if (!activeX || !guard.approvedXIds.includes(activeX)) {
    return { ok: false, message: "承認済みのX IDを選択してください。" };
  }

  const requestedEventIds = parseEventIdsFromForm(formData);
  if (requestedEventIds.length > MAX_ATOMIC_VIDEO_EVENTS) {
    return { ok: false, message: "選択イベント数が保存上限を超えています。" };
  }
  const stageFields = await getStagePermissionFieldsForEvents(db, requestedEventIds);
  const stagePermissionResult = buildStagePermissionSubmission(formData, stageFields);
  if (!stagePermissionResult.ok) return stagePermissionResult;
  if (await checkYoutubeVideoDuplicate(db, youtubeId)) {
    return { ok: false, message: "このYouTube動画は既に登録されています。" };
  }
  const memberValidation = validateVideoMemberSubmission(
    formData,
    parsed.data.is_collab ?? false,
  );
  if (!memberValidation.ok) return memberValidation;
  let syncedEventIds: string[];
  try {
    syncedEventIds = await resolveEventSyncTargetForNewVideo(db, {
      requested: requestedEventIds,
      user: { id: userId, role: sessionUser.role ?? null },
      linkPolicy: "unslotted_posts",
    });
  } catch (error) {
    console.warn("[createFreeVideo] event plan rejected", error);
    return { ok: false, message: "選択イベント数が保存上限を超えています。" };
  }
  if (
    sessionUser.role !== "admin" &&
    requestedEventIds.some((eventId) => !syncedEventIds.includes(eventId))
  ) {
    return { ok: false, message: "選択したイベントの一部には投稿できません。" };
  }
  const customValidation = await validateCustomAnswersForEvents(
    db,
    formData,
    syncedEventIds,
  );
  if (!customValidation.ok) return customValidation;

  const videoId = generateId("v");
  const now = Math.floor(Date.now() / 1000);
  const iconUrl = parsed.data.icon_url || null;
  const videoAfter: typeof videos.$inferSelect = {
    id: videoId,
    primary_event_id: syncedEventIds[0] ?? null,
    creator_x_user_id: activeX,
    submitted_by_user_id: userId,
    collaboration_type: parsed.data.is_collab ? "collab" : "individual",
    part: parsed.data.part?.trim() || null,
    source_type: "youtube",
    creator_display_name: parsed.data.display_name,
    creator_display_name_yomi: null,
    creator_icon_url: iconUrl,
    creator_youtube_channel_url: snapshotYoutubeChannelUrl(
      parsed.data.youtube_channel_url,
    ),
    title: parsed.data.title,
    music: parsed.data.music ?? null,
    credit: parsed.data.credit ?? null,
    music_reference_url: parsed.data.music_reference_url ?? null,
    closing_comment: parsed.data.closing_comment ?? null,
    youtube_video_id: youtubeId,
    intro_comment: parsed.data.intro_comment ?? null,
    highlights: parsed.data.highlights ?? null,
    production_story: parsed.data.production_story ?? null,
    visibility_status: "public",
    scheduling_type: "manual",
    scheduled_time: now,
    app_like_count: 0,
    score: 0,
    score_updated_at: null,
    created_at: now,
    updated_at: now,
  };

  try {
    const plan = emptyVideoAtomicWritePlan();
    appendVideoAtomicWritePlan(plan, await buildSubmissionXUserPlan(db, {
      xId: activeX,
      displayName: parsed.data.display_name,
      profileText: parsed.data.profile_text ?? null,
      youtubeChannelUrl: parsed.data.youtube_channel_url ?? null,
      socialLinks: parsed.data.other_social_links ?? null,
      allowProfileUpdate: true,
      actorUserId: userId,
    }));
    plan.statements.push(db.insert(videos).values(videoAfter));
    plan.expectedChanges.push(1);
    plan.audits.push({
      table_name: "videos",
      target_id: videoId,
      operation: "CREATE",
      before: null,
      after: { ...videoAfter },
      actor_user_id: userId,
      context: "video-save:create-free",
      retention_class: "normal",
      strict: true,
    });
    appendVideoAtomicWritePlan(plan, await buildVideoDerivedRowsPlan(db, {
      videoId, youtubeVideoId: youtubeId, now, actorUserId: userId,
    }));
    appendVideoAtomicWritePlan(plan, await buildReplaceVideoMembersPlan(db, {
      videoId,
      members: memberValidation.value.members,
      actorUserId: userId,
    }));
    appendVideoAtomicWritePlan(plan, await buildReplaceVideoSoftwarePlan(db, {
      videoId, raw: parsed.data.used_software ?? null, actorUserId: userId,
    }));
    appendVideoAtomicWritePlan(plan, await buildSyncVideoEventsPlan(db, videoId, {
      targetEventIds: syncedEventIds, actorUserId: userId,
    }));
    appendVideoAtomicWritePlan(plan, await buildReplaceStagePermissionAnswersPlan(db, {
      videoId,
      eventIds: syncedEventIds,
      stagePermission: stagePermissionResult.value,
      now,
      actorUserId: userId,
    }));
    appendVideoAtomicWritePlan(plan, await buildReplaceGeneralCustomAnswersPlan(db, {
      videoId,
      eventIds: syncedEventIds,
      drafts: customValidation.drafts,
      now,
      actorUserId: userId,
    }));
    const notification = await buildNotificationOutboxStatement(db, {
      recipientUserId: userId,
      type: "video_submitted",
      dedupeKey: `video_submitted:${videoId}`,
      payload: buildFreeVideoSubmittedNotification({
        videoId,
        videoTitle: parsed.data.title,
        youtubeVideoId: youtubeId,
        hasLinkedEvent: requestedEventIds.length > 0,
      }),
      eventId: syncedEventIds[0] ?? null,
    });
    if (notification) {
      plan.statements.push(notification);
      plan.expectedChanges.push(1);
    }
    const queue = await buildStaticRebuildQueueBatch(db, [
      { targetType: "video", targetId: videoId, reason: "video_create", priority: "high", requestedByUserId: userId },
      { targetType: "top", targetId: "global", reason: "video_create" },
      { targetType: "list_recent", targetId: "global", reason: "video_create" },
      { targetType: "list_popular", targetId: "global", reason: "video_create" },
      { targetType: "search_index", targetId: "global", reason: "video_create" },
      { targetType: "user", targetId: activeX, reason: "video_create" },
      ...syncedEventIds.map((eventId) => ({
        targetType: "event" as const,
        targetId: eventId,
        reason: "video_create",
        priority: "high" as const,
      })),
    ]);
    plan.statements.push(...queue.statements);
    plan.expectedChanges.push(...queue.expectedChanges);
    await executeVideoAtomicWritePlan(db, plan);
  } catch (error) {
    if (isYoutubeIdUniqueConstraintError(error)) {
      return { ok: false, message: "このYouTube動画は既に登録されています。" };
    }
    console.warn("[createFreeVideo] atomic save rejected", error);
    return {
      ok: false,
      message: "保存対象が多すぎるか競合が発生しました。入力を確認して再試行してください。",
    };
  }

  revalidatePath("/");
  revalidatePath("/list");
  revalidatePath("/dashboard");
  return { ok: true, videoId, youtubeVideoId: youtubeId };
}
