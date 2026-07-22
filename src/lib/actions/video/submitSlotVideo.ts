"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, or } from "drizzle-orm";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { writeGuard } from "@/lib/auth/writeGuard";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots,
  videos,
  xUsers,
} from "@/lib/db/schema";
import { buildReplaceVideoSoftwarePlan } from "@/lib/db/software";
import {
  snapshotYoutubeChannelUrl,
} from "@/lib/db/youtubeChannelCandidates";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { buildSlotVideoSubmittedNotification } from "@/lib/notifications/templates/slot";
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
  resolveVideoEventSyncTargetIds,
} from "@/lib/video/syncVideoEvents";
import {
  checkYoutubeVideoDuplicate,
  resolvePartFromSlot,
} from "@/lib/video/slotPart";
import type { VideoActionResult } from "@/lib/video/types";
import { parseVideoForm } from "@/lib/video/videoFormSchema";
import { isYoutubeIdUniqueConstraintError } from "@/lib/video/youtubeDuplicate";
import { MAX_ATOMIC_SUBMITTED_SLOTS } from "@/lib/video/atomicLimits";

export async function submitSlotVideo(formData: FormData): Promise<VideoActionResult> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "post_video_slotted",
  });
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
  const sessionUser = guard.user;
  const userId = sessionUser.id;
  const slotId = String(formData.get("slot_id") ?? "");
  if (!slotId) return { ok: false, message: "枠IDがありません。" };
  const parsed = parseVideoForm(Object.fromEntries(formData), { youtubeRequired: false });
  if (!parsed.ok) return parsed;
  const youtubeId = extractYoutubeId(parsed.data.youtube_url) ?? null;
  const db = getDatabase();
  if (!db) return { ok: false, message: "DBに接続できません。" };

  const requestedX = normalizeXId(sessionUser.active_x_user_id);
  const slotOwnerWhere = requestedX
    ? or(
        eq(slots.x_user_id, requestedX),
        and(eq(slots.reserved_by_user_id, userId), isNull(slots.x_user_id))!,
      )
    : eq(slots.reserved_by_user_id, userId);
  const slotRow = (
    await db.select().from(slots).where(and(eq(slots.id, slotId), slotOwnerWhere)!).limit(1)
  )[0];
  if (!slotRow) return { ok: false, message: "枠が見つかりません。" };

  const videoId = slotRow.video_id ?? generateId("v");
  const existingVideo = slotRow.video_id
    ? (await db.select().from(videos).where(eq(videos.id, videoId)).limit(1))[0]
    : null;
  if (slotRow.video_id && !existingVideo) {
    return { ok: false, message: "枠に紐づく作品が見つかりません。" };
  }
  const slotX = normalizeXId(slotRow.x_user_id);
  const activeX = slotX || normalizeXId(requestedX || slotRow.x_user_id);
  if (!activeX || !guard.approvedXIds.includes(activeX)) {
    return { ok: false, message: "承認済みのX IDを選択してください。" };
  }
  if (slotX && slotX !== normalizeXId(requestedX || slotRow.x_user_id)) {
    return { ok: false, message: "投稿主体のX IDは予約時のIDに固定されています。" };
  }

  const stageFields = await getStagePermissionFieldsForEvents(db, [slotRow.event_id]);
  const stageResult = buildStagePermissionSubmission(formData, stageFields);
  if (!stageResult.ok) return stageResult;
  const slotPart = await resolvePartFromSlot(db, slotRow);
  if (youtubeId && await checkYoutubeVideoDuplicate(db, youtubeId, existingVideo?.id)) {
    return { ok: false, message: "このYouTube動画は既に登録されています。" };
  }
  const memberValidation = validateVideoMemberSubmission(
    formData,
    parsed.data.is_collab ?? false,
  );
  if (!memberValidation.ok) return memberValidation;
  const requestedEventIds = parseEventIdsFromForm(formData);
  let syncedEventIds: string[];
  try {
    syncedEventIds = await resolveVideoEventSyncTargetIds(db, videoId, {
      requested: requestedEventIds,
      alwaysInclude: [slotRow.event_id],
      user: { id: userId, role: sessionUser.role ?? null },
    });
  } catch (error) {
    console.warn("[submitSlotVideo] event plan rejected", error);
    return { ok: false, message: "選択イベント数が保存上限を超えています。" };
  }
  const customValidation = await validateCustomAnswersForEvents(db, formData, syncedEventIds);
  if (!customValidation.ok) return customValidation;

  const eventConfig = (
    await db
      .select({
        title: eventsTable.title,
        max_slots_per_video: eventsTable.max_slots_per_video,
      })
      .from(eventsTable)
      .where(eq(eventsTable.id, slotRow.event_id))
      .limit(1)
  )[0];
  if (!eventConfig) return { ok: false, message: "イベントが見つかりません。" };
  const eventSlotLimit = Math.min(
    Math.max(1, Number(eventConfig.max_slots_per_video ?? 1)),
    MAX_ATOMIC_SUBMITTED_SLOTS,
  );
  const slotGroupWhere = slotRow.reservation_group_id
    ? and(
        eq(slots.reservation_group_id, slotRow.reservation_group_id),
        eq(slots.event_id, slotRow.event_id),
        eq(slots.reserved_by_user_id, userId),
        slotRow.x_user_id ? eq(slots.x_user_id, slotRow.x_user_id) : isNull(slots.x_user_id),
      )!
    : eq(slots.id, slotRow.id);
  const submittedSlots = await db
    .select()
    .from(slots)
    .where(slotGroupWhere)
    .limit(MAX_ATOMIC_SUBMITTED_SLOTS + 1);
  if (submittedSlots.length === 0 || submittedSlots.length > eventSlotLimit) {
    return { ok: false, message: "同時に更新する枠数が上限を超えています。" };
  }
  const now = Math.floor(Date.now() / 1000);
  const xProfile = (
    await db.select().from(xUsers).where(eq(xUsers.id, activeX)).limit(1)
  )[0];
  const displayName = parsed.data.display_name || slotRow.display_name || xProfile?.x_name || sessionUser.name || "anonymous";
  const videoAfter: typeof videos.$inferSelect = existingVideo
    ? {
        ...existingVideo,
        title: parsed.data.title,
        // 空送信では既存 ID を維持（updateVideo と同じ）。新規追加・変更時のみ上書き。
        youtube_video_id: youtubeId ?? existingVideo.youtube_video_id,
        creator_x_user_id: activeX,
        creator_display_name: parsed.data.display_name,
        creator_icon_url: parsed.data.icon_url || null,
        creator_youtube_channel_url: snapshotYoutubeChannelUrl(parsed.data.youtube_channel_url),
        music: parsed.data.music ?? null,
        music_reference_url: parsed.data.music_reference_url ?? null,
        credit: parsed.data.credit ?? null,
        intro_comment: parsed.data.intro_comment ?? null,
        highlights: parsed.data.highlights ?? null,
        production_story: parsed.data.production_story ?? null,
        closing_comment: parsed.data.closing_comment ?? null,
        collaboration_type: parsed.data.is_collab ? "collab" : "individual",
        part: slotPart,
        updated_at: now,
      }
    : {
        id: videoId,
        primary_event_id: slotRow.event_id,
        creator_x_user_id: activeX,
        submitted_by_user_id: userId,
        collaboration_type: parsed.data.is_collab ? "collab" : "individual",
        part: slotPart,
        source_type: "youtube",
        creator_display_name: displayName,
        creator_display_name_yomi: null,
        creator_icon_url: parsed.data.icon_url || null,
        creator_youtube_channel_url: snapshotYoutubeChannelUrl(parsed.data.youtube_channel_url),
        title: parsed.data.title,
        music: parsed.data.music ?? null,
        credit: parsed.data.credit ?? null,
        music_reference_url: parsed.data.music_reference_url ?? null,
        closing_comment: parsed.data.closing_comment ?? null,
        youtube_video_id: youtubeId,
        intro_comment: parsed.data.intro_comment ?? null,
        highlights: parsed.data.highlights ?? null,
        production_story: parsed.data.production_story ?? null,
        visibility_status: "pending",
        scheduling_type: "slotted",
        scheduled_time: slotRow.start_time ?? now,
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
    plan.statements.push(
      existingVideo
        ? db.update(videos).set(videoAfter).where(and(
            eq(videos.id, videoId),
            expectedRowCondition({ expectedCurrent: existingVideo }),
          )!)
        : db.insert(videos).values(videoAfter),
    );
    plan.expectedChanges.push(1);
    plan.audits.push({
      table_name: "videos",
      target_id: videoId,
      operation: existingVideo ? "UPDATE" : "CREATE",
      before: existingVideo ? { ...existingVideo } : null,
      after: { ...videoAfter },
      actor_user_id: userId,
      context: "video-save:submit-slot",
      retention_class: "normal",
      strict: true,
    });
    if (youtubeId) {
      appendVideoAtomicWritePlan(plan, await buildVideoDerivedRowsPlan(db, {
        videoId, youtubeVideoId: youtubeId, now, actorUserId: userId,
      }));
    }
    appendVideoAtomicWritePlan(plan, await buildReplaceVideoSoftwarePlan(db, {
      videoId, raw: parsed.data.used_software ?? null, actorUserId: userId,
    }));
    appendVideoAtomicWritePlan(plan, await buildSyncVideoEventsPlan(db, videoId, {
      targetEventIds: syncedEventIds, actorUserId: userId,
    }));
    appendVideoAtomicWritePlan(plan, await buildReplaceStagePermissionAnswersPlan(db, {
      videoId, eventIds: syncedEventIds, stagePermission: stageResult.value, now,
      actorUserId: userId,
    }));
    appendVideoAtomicWritePlan(plan, await buildReplaceGeneralCustomAnswersPlan(db, {
      videoId, eventIds: syncedEventIds, drafts: customValidation.drafts, now,
      actorUserId: userId,
    }));
    appendVideoAtomicWritePlan(plan, await buildReplaceVideoMembersPlan(db, {
      videoId,
      members: memberValidation.value.members,
      chaptersByIndex: memberValidation.value.chaptersByIndex,
      actorUserId: userId,
    }));
    for (const row of submittedSlots) {
      const after = {
        ...row,
        status: "submitted" as const,
        video_id: videoId,
        updated_at: now,
        version: row.version + 1,
      };
      plan.statements.push(db.update(slots).set({
        status: after.status,
        video_id: after.video_id,
        updated_at: after.updated_at,
        version: after.version,
      }).where(and(
        eq(slots.id, row.id),
        expectedRowCondition({ expectedCurrent: row }),
      )!));
      plan.expectedChanges.push(1);
      plan.audits.push({
        table_name: "slots",
        target_id: row.id,
        operation: "UPDATE",
        before: { ...row },
        after,
        actor_user_id: userId,
        context: "video-save:submit-slot",
        retention_class: "normal",
        strict: true,
      });
    }

    if (!existingVideo) {
      const notification = await buildNotificationOutboxStatement(db, {
        recipientUserId: userId,
        type: "slot_video_submitted",
        dedupeKey: `slot_video_submitted:${videoId}:${slotRow.id}`,
        payload: buildSlotVideoSubmittedNotification({
          videoId,
          videoTitle: parsed.data.title,
          eventId: slotRow.event_id,
          eventTitle: eventConfig.title ?? "イベント",
        }),
        eventId: slotRow.event_id,
      });
      if (notification) {
        plan.statements.push(notification.statement);
        plan.expectedChanges.push(1);
      }
    }
    const queue = await buildStaticRebuildQueueBatch(db, [
      { targetType: "video", targetId: videoId, reason: existingVideo ? "video_update" : "video_create", priority: "high", requestedByUserId: userId },
      { targetType: "top", targetId: "global", reason: "video_submit" },
      { targetType: "list_recent", targetId: "global", reason: "video_submit" },
      { targetType: "list_popular", targetId: "global", reason: "video_submit" },
      { targetType: "search_index", targetId: "global", reason: "video_submit" },
      { targetType: "user", targetId: activeX, reason: "video_submit" },
      ...syncedEventIds.map((eventId) => ({
        targetType: "event" as const,
        targetId: eventId,
        reason: "video_submit",
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
    console.warn("[submitSlotVideo] atomic save rejected", error);
    return { ok: false, message: "保存対象が多すぎるか競合が発生しました。再読み込みして再試行してください。" };
  }

  revalidatePath("/");
  revalidatePath(`/event/${slotRow.event_id}`);
  revalidatePath(`/event/${slotRow.event_id}/slots`);
  revalidatePath("/dashboard");
  return { ok: true, videoId, youtubeVideoId: youtubeId ?? undefined, eventId: slotRow.event_id };
}
