"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { writeGuard } from "@/lib/auth/writeGuard";
import { validateActiveXSnapshot } from "@/lib/auth/activeXSnapshotCore";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { videos, events } from "@/lib/db/schema";
import { buildReplaceVideoSoftwarePlan } from "@/lib/db/software";
import { snapshotYoutubeChannelUrl } from "@/lib/db/youtubeChannelCandidates";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { buildFreeVideoSubmittedNotification } from "@/lib/notifications/templates/video";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { buildFreeVideoRebuildTargets } from "@flamenode/server-core/video/freeVideoRebuildTargets";
import { buildFreeVideoRow } from "@flamenode/server-core/video/freeVideoRow";
import { buildFreeVideoInsertPlan } from "@flamenode/server-core/video/freeVideoInsertPlan";
import { markPendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import { sendYoutubeSyncPendingWakeBestEffort } from "@/lib/queues/youtubeSyncWake";
import type { QueueWakeKind } from "@/lib/queues/wakeBudget";
import { generateId } from "@/lib/utils/id";
import { parseJstDatetimeLocalStrict } from "@/lib/utils/dateInput";
import { extractYoutubeId } from "@/lib/youtube/id";
import {
  appendVideoAtomicWritePlan,
  emptyVideoAtomicWritePlan,
  executeVideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { buildReplaceGeneralCustomAnswersPlan } from "@/lib/video/customQuestionAnswers";
import { normalizeSocialLinksForStorage } from "@/lib/socialLinks";
import { buildReplaceVideoMembersPlan } from "@/lib/video/replaceVideoMembers";
import {
  UnslottedEventSyncError,
  buildUnslottedEventEligibilityAssertionPlan,
  buildUnslottedVideoEventPlan,
  parseUnslottedEventIdFromForm,
  resolveUnslottedEventIdForNewVideo,
} from "@/lib/video/resolveUnslottedEventSyncTarget";
import {
  validateCustomAnswersForEvents,
  validateVideoMemberSubmission,
} from "@/lib/video/submissionValidation";
import { buildVideoDerivedRowsPlan } from "@/lib/video/syncVideoEvents";
import { checkYoutubeVideoDuplicate } from "@/lib/video/slotPart";
import type { VideoActionResult } from "@/lib/video/types";
import { parseVideoForm } from "@/lib/video/videoFormSchema";
import {
  firstMissingRequiredVideoField,
  loadUnionRequiredVideoFields,
  missingRequiredVideoFieldMessage,
} from "@/lib/video/requiredVideoFields";
import {
  resolveVideoCreatorIcon,
  rollbackUploadedVideoIcon,
} from "@/lib/video/resolveVideoCreatorIcon";
import { cleanupReplacedVideoCreatorIcon } from "@/lib/video/videoIconPostCommit";
import { isYoutubeIdUniqueConstraintError } from "@/lib/video/youtubeDuplicate";

const CREATE_FREE_VIDEO_UNEXPECTED_ERROR_MESSAGE =
  "投稿処理中に一時的なエラーが発生しました。入力内容を確認して、もう一度お試しください。";

export async function createFreeVideo(formData: FormData): Promise<VideoActionResult> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "post_video_unslotted",
  });
  if (!guard.ok) {
    return { ok: false, reason: guard.reason, message: guard.message };
  }

  const db = guard.db;
  const sessionUser = guard.user;
  const userId = sessionUser.id;
  const activeX = guard.activeXId;
  if (!activeX || !guard.approvedXIds.includes(activeX)) {
    return { ok: false, message: "承認済みのX IDを選択してください。" };
  }

  const snapshotCheck = validateActiveXSnapshot({
    submittedSnapshot: String(formData.get("active_x_snapshot") ?? ""),
    currentActiveXId: activeX,
  });
  if (!snapshotCheck.ok) return { ok: false, message: snapshotCheck.message };

  const parsed = parseVideoForm(Object.fromEntries(formData));
  if (!parsed.ok) return parsed;
  const youtubeId = extractYoutubeId(parsed.data.youtube_url);
  if (!youtubeId) {
    return { ok: false, message: "YouTube URLを解析できません。" };
  }

  let requestedEventId: string | null;
  try {
    requestedEventId = parseUnslottedEventIdFromForm(formData);
  } catch (error) {
    console.warn("[createFreeVideo] invalid event selection", error);
    return { ok: false, message: "枠なし投稿で所属できるイベントは1件までです。" };
  }

  let eventId: string | null;
  try {
    eventId = await resolveUnslottedEventIdForNewVideo(db, requestedEventId);
  } catch (error) {
    console.warn("[createFreeVideo] event affiliation rejected", error);
    if (
      error instanceof UnslottedEventSyncError &&
      error.code === "unslotted_event_selection_invalid"
    ) {
      return { ok: false, message: "枠なし投稿で所属できるイベントは1件までです。" };
    }
    return {
      ok: false,
      message:
        "選択したイベントは枠なし投稿を受け付けていません。公開状態・終了日時・イベント設定を確認してください。",
    };
  }
  const eventIds = eventId ? [eventId] : [];
  const missingRequired = firstMissingRequiredVideoField(
    await loadUnionRequiredVideoFields(db, eventIds),
    { ...parsed.data, existing_icon_url: null },
  );
  if (missingRequired) {
    return { ok: false, message: missingRequiredVideoFieldMessage(missingRequired) };
  }

  let youtubeDuplicate = false;
  try {
    youtubeDuplicate = await checkYoutubeVideoDuplicate(db, youtubeId);
  } catch (error) {
    console.warn("[createFreeVideo] duplicate check failed", error);
    return { ok: false, message: CREATE_FREE_VIDEO_UNEXPECTED_ERROR_MESSAGE };
  }
  if (youtubeDuplicate) {
    return { ok: false, message: "このYouTube動画は既に登録されています。" };
  }

  const memberValidation = validateVideoMemberSubmission(
    formData,
    parsed.data.is_collab ?? false,
  );
  if (!memberValidation.ok) return memberValidation;

  // 質問定義・回答は event_custom_questions / video_custom_answers だけを使用する。
  let customValidation: Awaited<
    ReturnType<typeof validateCustomAnswersForEvents>
  >;
  try {
    customValidation = await validateCustomAnswersForEvents(
      db,
      formData,
      eventIds,
    );
  } catch (error) {
    console.warn("[createFreeVideo] custom answer validation failed", error);
    return { ok: false, message: CREATE_FREE_VIDEO_UNEXPECTED_ERROR_MESSAGE };
  }
  if (!customValidation.ok) return customValidation;

  const videoId = generateId("v");
  const now = Math.floor(Date.now() / 1000);
  const scheduledRaw = String(formData.get("scheduled_time") ?? "");
  const scheduledParsed = parseJstDatetimeLocalStrict(scheduledRaw);
  if (!scheduledParsed.ok) {
    return { ok: false, message: "scheduled_time の日時が正しくありません。" };
  }
  const scheduledTime = scheduledParsed.value ?? now;
  let iconResolved: Awaited<ReturnType<typeof resolveVideoCreatorIcon>>;
  try {
    iconResolved = await resolveVideoCreatorIcon({
      formData,
      parsed: parsed.data,
      activeXId: activeX,
      videoId,
      existingIconUrl: null,
      db,
    });
  } catch (error) {
    console.warn("[createFreeVideo] creator icon resolution failed", error);
    return { ok: false, message: CREATE_FREE_VIDEO_UNEXPECTED_ERROR_MESSAGE };
  }
  if (!iconResolved.ok) return iconResolved;
  const videoAfter = buildFreeVideoRow({
    videoId,
    eventId,
    activeX,
    userId,
    data: parsed.data,
    iconUrl: iconResolved.value.iconUrl,
    creatorYoutubeChannelUrl: snapshotYoutubeChannelUrl(parsed.data.youtube_channel_url),
    creatorOtherSocialLinks: normalizeSocialLinksForStorage(parsed.data.other_social_links),
    youtubeId,
    scheduledTime,
    now,
  });

  let staticRebuildEnqueued = false;
  const wakeSentKinds = new Set<QueueWakeKind>();
  try {
    const plan = emptyVideoAtomicWritePlan();
    appendVideoAtomicWritePlan(
      plan,
      buildUnslottedEventEligibilityAssertionPlan(db, eventId, now),
    );

    appendVideoAtomicWritePlan(
      plan,
      buildFreeVideoInsertPlan(db, videoAfter, userId),
    );

    appendVideoAtomicWritePlan(
      plan,
      await buildVideoDerivedRowsPlan(db, {
        videoId,
        youtubeVideoId: youtubeId,
        now,
        actorUserId: userId,
      }),
    );
    appendVideoAtomicWritePlan(
      plan,
      await buildReplaceVideoMembersPlan(db, {
        videoId,
        members: memberValidation.value.members,
        chaptersByIndex: memberValidation.value.chaptersByIndex,
        actorUserId: userId,
      }),
    );
    appendVideoAtomicWritePlan(
      plan,
      await buildReplaceVideoSoftwarePlan(db, {
        videoId,
        raw: parsed.data.used_software ?? null,
        actorUserId: userId,
      }),
    );
    appendVideoAtomicWritePlan(
      plan,
      buildUnslottedVideoEventPlan(db, { videoId, eventId, actorUserId: userId }),
    );
    appendVideoAtomicWritePlan(
      plan,
      await buildReplaceGeneralCustomAnswersPlan(db, {
        videoId,
        eventIds,
        drafts: customValidation.drafts,
        now,
        actorUserId: userId,
      }),
    );

    const notification = await buildNotificationOutboxStatement(db, {
      recipientUserId: userId,
      type: "video_submitted",
      dedupeKey: `video_submitted:${videoId}`,
      payload: buildFreeVideoSubmittedNotification({
        videoId,
        videoTitle: parsed.data.title,
        youtubeVideoId: youtubeId,
        hasLinkedEvent: eventId !== null,
      }),
      eventId,
    });
    let notificationWakeSource: "web" | undefined;
    if (notification) {
      plan.statements.push(notification.statement);
      plan.expectedChanges.push(null);
      notificationWakeSource = "web";
    }
    const { buildVideoRegisteredChannelStatement } = await import(
      "@/lib/notifications/videoRegisteredChannel"
    );
    const eventTitle = eventId
      ? (
          await db
            .select({ title: events.title })
            .from(events)
            .where(eq(events.id, eventId))
            .limit(1)
        )[0]?.title ?? null
      : null;
    const channelNotification = await buildVideoRegisteredChannelStatement(db, {
      actorUserId: userId,
      videoId,
      videoTitle: parsed.data.title,
      youtubeVideoId: youtubeId,
      registrationKind: eventId ? "free" : "unaffiliated",
      eventId,
      eventTitle,
      creatorDisplayName: parsed.data.display_name,
    });
    if (channelNotification) {
      plan.statements.push(channelNotification.statement);
      plan.expectedChanges.push(null);
      notificationWakeSource = "web";
    }

    const queueTargets = buildFreeVideoRebuildTargets({
      videoId,
      userId,
      activeXId: activeX,
      eventId,
    });
    const queue = await buildStaticRebuildQueueBatch(db, queueTargets);
    staticRebuildEnqueued = queue.statements.length > 0;
    plan.statements.push(...queue.statements);
    plan.expectedChanges.push(...queue.expectedChanges);

    await executeVideoAtomicWritePlan(db, plan, {
      notificationWakeSource,
      staticRebuildWakeSource: queue.statements.length > 0 ? "web" : undefined,
      wakeSentKinds,
    });
  } catch (error) {
    unstable_rethrow(error);
    await rollbackUploadedVideoIcon(iconResolved.value.uploadedKey);
    if (isYoutubeIdUniqueConstraintError(error)) {
      return { ok: false, message: "このYouTube動画は既に登録されています。" };
    }
    console.warn("[createFreeVideo] atomic save rejected", error);
    return {
      ok: false,
      message:
        "イベント設定が変更されたか、保存内容が競合しました。入力内容を確認して再試行してください。",
    };
  }

  await runPostCommitBestEffort(
    { flow: "video.create_free" },
    [
      {
        name: "youtube_sync_wake",
        run: async () => {
          await sendYoutubeSyncPendingWakeBestEffort("web", wakeSentKinds);
        },
      },
      {
        name: "icon_orphan_cleanup",
        run: async () => {
          await cleanupReplacedVideoCreatorIcon(db, null, iconResolved.value.iconUrl);
        },
      },
      {
        name: "revalidate",
        run: async () => {
          revalidatePath("/");
          revalidatePath("/list");
          revalidatePath("/dashboard");
        },
      },
    ],
  );
  return markPendingPublicReflection(
    {
      ok: true,
      videoId,
      youtubeVideoId: youtubeId,
      eventId: eventId ?? undefined,
    },
    staticRebuildEnqueued,
  );
}
