"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import { validateActiveXSnapshot } from "@/lib/auth/activeXSnapshotCore";
import { writeGuard } from "@/lib/auth/writeGuard";
import {
  events as eventsTable,
  slots,
  videos,
} from "@/lib/db/schema";
import { buildReplaceVideoSoftwarePlan } from "@/lib/db/software";
import {
  snapshotYoutubeChannelUrl,
} from "@/lib/db/youtubeChannelCandidates";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { buildSlotVideoSubmittedNotification } from "@/lib/notifications/templates/slot";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { topSlotStatsGlobalTarget, topVideoVisibilityTargets } from "@/lib/staticRebuild/hooks";
import type { EnqueueStaticRebuildInput } from "@/lib/staticRebuild/types";
import { markPendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import { sendYoutubeSyncPendingWakeBestEffort } from "@/lib/queues/youtubeSyncWake";
import type { QueueWakeKind } from "@/lib/queues/wakeBudget";
import { generateId } from "@/lib/utils/id";
import {
  canActAsSlotSubmitter,
  resolveSlotGroupIdentity,
  resolveSlotSubmissionRelation,
} from "@/lib/slots/slotIdentityCore";
import { extractYoutubeId } from "@/lib/youtube/id";
import { resolveSlotReservationSubject } from "@/lib/slot/reservationGroupsCore";
import {
  appendVideoAtomicWritePlan,
  emptyVideoAtomicWritePlan,
  executeVideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { buildReplaceGeneralCustomAnswersPlan } from "@/lib/video/customQuestionAnswers";
import { normalizeSocialLinksForStorage } from "@/lib/socialLinks";
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
  buildVideoMetadataClearPlan,
  buildVideoDerivedRowsPlan,
  resolveVideoEventSyncTargetIds,
} from "@/lib/video/syncVideoEvents";
import {
  checkYoutubeVideoDuplicate,
  resolvePartFromSlot,
} from "@/lib/video/slotPart";
import type { VideoActionResult } from "@/lib/video/types";
import { parseVideoForm } from "@/lib/video/videoFormSchema";
import {
  resolveVideoCreatorIcon,
  rollbackUploadedVideoIcon,
} from "@/lib/video/resolveVideoCreatorIcon";
import { cleanupReplacedVideoCreatorIcon } from "@/lib/video/videoIconPostCommit";
import { isYoutubeIdUniqueConstraintError } from "@/lib/video/youtubeDuplicate";
import { MAX_SLOTS_PER_VIDEO } from "@/lib/slots/limits";
import { versionedSlotWhere } from "@/lib/slots/versionedPredicate";
import {
  areSlotsInSamePart,
  sortSlotsChronologically,
} from "@/lib/utils/slotGroupingCore";

const MAX_SUBMIT_SLOT_REBUILD_EVENT_TARGETS = 5;

const SLOT_SUBMIT_REJECT_MESSAGE = "枠が見つかりません。";
const SLOT_GROUP_REJECT_MESSAGE =
  "この枠は現在とは別の活動名義で確保されています。Active X IDを切り替えてから操作してください。";

async function submitSlotVideoCore(
  formData: FormData,
): Promise<VideoActionResult> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "post_video_slotted",
  });
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
  const sessionUser = guard.user;
  const userId = sessionUser.id;
  const slotId = String(formData.get("slot_id") ?? "");
  if (!slotId) return { ok: false, message: "枠IDがありません。" };
  // writeGuard has already resolved and authorized the request-local D1
  // binding. Re-resolving getDatabase() here can fail independently in a
  // Cloudflare request context and used to surface as the generic client-side
  // "unexpected error" before any action result was returned.
  const db = guard.db;

  const slotRow = (
    await db.select().from(slots).where(eq(slots.id, slotId)).limit(1)
  )[0];
  if (!slotRow) return { ok: false, message: SLOT_SUBMIT_REJECT_MESSAGE };

  // Submission is keyed by the approved Active X ID. A linked Discord
  // account may submit the reservation when that X ID matches, while other
  // slot operations remain bound to the reserving Discord account.
  const slotRelation = resolveSlotSubmissionRelation({
    reservedByUserId: slotRow.reserved_by_user_id,
    slotXUserId: slotRow.x_user_id,
    authUserId: userId,
    activeXId: guard.activeXId,
  });
  if (!canActAsSlotSubmitter(slotRelation)) {
    return { ok: false, message: SLOT_SUBMIT_REJECT_MESSAGE };
  }

  const snapshotCheck = validateActiveXSnapshot({
    submittedSnapshot: String(formData.get("active_x_snapshot") ?? ""),
    currentActiveXId: guard.activeXId,
  });
  if (!snapshotCheck.ok) return { ok: false, message: snapshotCheck.message };

  const activeX = guard.activeXId;
  if (!activeX || !guard.approvedXIds.includes(activeX)) {
    return { ok: false, message: "承認済みのX IDを選択してください。" };
  }

  const parsed = parseVideoForm(Object.fromEntries(formData), { youtubeRequired: false });
  if (!parsed.ok) return parsed;
  // FormData presence is significant for re-submission: an omitted field keeps
  // the existing snapshot, while an explicitly empty field clears it.
  const youtubeFieldPresent = formData.has("youtube_url");
  const profileFieldPresent = formData.has("profile_text");
  const socialLinksFieldPresent = formData.has("other_social_links");
  const youtubeChannelFieldPresent = formData.has("youtube_channel_url");
  const submittedYoutubeId = extractYoutubeId(parsed.data.youtube_url) ?? null;

  const videoId = slotRow.video_id ?? generateId("v");
  const existingVideo = slotRow.video_id
    ? (await db.select().from(videos).where(eq(videos.id, videoId)).limit(1))[0]
    : null;
  if (slotRow.video_id && !existingVideo) {
    return { ok: false, message: "枠に紐づく作品が見つかりません。" };
  }
  // A new slotted video may be saved before its YouTube URL is known. Keep the
  // source_type as youtube and leave youtube_video_id nullable so the creator
  // can add the URL later through the normal edit action. Existing submissions
  // still support an explicit clear when the field is present and empty.

  const slotPart = await resolvePartFromSlot(db, slotRow);
  if (
    submittedYoutubeId &&
    await checkYoutubeVideoDuplicate(db, submittedYoutubeId, existingVideo?.id)
  ) {
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
  let stageFields: Awaited<ReturnType<typeof getStagePermissionFieldsForEvents>>;
  try {
    stageFields = await getStagePermissionFieldsForEvents(db, syncedEventIds);
  } catch (error) {
    console.warn("[submitSlotVideo] stage permission fields read rejected", error);
    return { ok: false, message: "ステージ許諾項目を読み込めませんでした。" };
  }
  const stageResult = buildStagePermissionSubmission(formData, stageFields);
  if (!stageResult.ok) return stageResult;
  const customValidation = await validateCustomAnswersForEvents(db, formData, syncedEventIds);
  if (!customValidation.ok) return customValidation;

  const eventConfig = (
    await db
      .select({
        title: eventsTable.title,
        slot_part_gap_minutes: eventsTable.slot_part_gap_minutes,
      })
      .from(eventsTable)
      .where(eq(eventsTable.id, slotRow.event_id))
      .limit(1)
  )[0];
  if (!eventConfig) return { ok: false, message: "イベントが見つかりません。" };
  // 提出可否は現行 events.max_slots_per_video では制限しない（grandfather）。
  // 絶対上限のみ MAX_SLOTS_PER_VIDEO で fail-closed。
  let submittedSlots: typeof slots.$inferSelect[];
  if (slotRow.reservation_group_id) {
    const groupRows = sortSlotsChronologically(
      await db
        .select()
        .from(slots)
        .where(
          and(
            eq(slots.reservation_group_id, slotRow.reservation_group_id),
            eq(slots.event_id, slotRow.event_id),
          )!,
        )
        .limit(MAX_SLOTS_PER_VIDEO + 1),
    );
    if (groupRows.length > MAX_SLOTS_PER_VIDEO) {
      return { ok: false, message: "連続枠の件数が上限を超えています。" };
    }
    if (!groupRows.some((row) => row.id === slotRow.id)) {
      return {
        ok: false,
        message: "連続枠の予約者情報が不整合です。運営へ連絡してください。",
      };
    }
    const groupSnapshotXId = groupRows[0]?.reserved_x_id_snapshot ?? null;
    if (
      groupRows.some(
        (candidate) => candidate.reserved_x_id_snapshot !== groupSnapshotXId,
      )
    ) {
      return {
        ok: false,
        message: "予約グループのX IDスナップショットが一致しません。",
      };
    }
    const subjectResult = resolveSlotReservationSubject(groupRows);
    if (!subjectResult.ok) {
      return {
        ok: false,
        message: "連続枠の予約者情報が不整合です。運営へ連絡してください。",
      };
    }
    const subject = subjectResult.subject;
    const subjectRelation = resolveSlotSubmissionRelation({
      reservedByUserId: subject.reservedByUserId,
      slotXUserId: subject.xUserId,
      authUserId: userId,
      activeXId: activeX,
    });
    if (!canActAsSlotSubmitter(subjectRelation)) {
      return { ok: false, message: "枠が見つかりません。" };
    }
    if (subject.xUserId) {
      if (!guard.approvedXIds.includes(subject.xUserId)) {
        return { ok: false, message: "承認済みのX IDを選択してください。" };
      }
      if (activeX && subject.xUserId !== activeX) {
        return {
          ok: false,
          message: "投稿主体のX IDは予約時のIDに固定されています。",
        };
      }
    }
    if (groupRows.some((row) => row.status !== "reserved")) {
      return { ok: false, message: "予約中でない枠を含む連続枠は提出できません。" };
    }
    if (!groupRows.every((row) => row.id === slotRow.id || row.video_id === slotRow.video_id)) {
      return { ok: false, message: "連続枠に別の作品が紐づいています。" };
    }
    submittedSlots = groupRows;
  } else {
    submittedSlots = [slotRow];
  }

  if (submittedSlots.length === 0 || submittedSlots.length > MAX_SLOTS_PER_VIDEO) {
    return { ok: false, message: "同時に更新する枠数が上限を超えています。" };
  }
  if (submittedSlots.some((row) => row.status !== "reserved")) {
    return { ok: false, message: "予約中の枠だけ作品を提出できます。" };
  }
  const slotGapSec = (eventConfig.slot_part_gap_minutes ?? 15) * 60;
  const orderedSubmittedSlots = sortSlotsChronologically(submittedSlots);
  for (let index = 1; index < orderedSubmittedSlots.length; index += 1) {
    if (
      !areSlotsInSamePart(
        orderedSubmittedSlots[index - 1],
        orderedSubmittedSlots[index],
        slotGapSec,
      )
    ) {
      return { ok: false, message: "連続していない枠をまとめて提出できません。" };
    }
  }

  const groupIdentity = resolveSlotGroupIdentity({
    reservedByUserIds: submittedSlots.map((row) => row.reserved_by_user_id),
    slotXUserIds: submittedSlots.map((row) => row.x_user_id),
    authUserId: userId,
    activeXId: guard.activeXId,
    allowAuthMismatchWhenXIdMatches: true,
  });
  if (!groupIdentity.ok) {
    if (
      groupIdentity.reason === "mixed_non_null_x" ||
      groupIdentity.reason === "different_active_x"
    ) {
      return { ok: false, message: SLOT_GROUP_REJECT_MESSAGE };
    }
    return { ok: false, message: SLOT_SUBMIT_REJECT_MESSAGE };
  }
  for (const row of submittedSlots) {
    const relation = resolveSlotSubmissionRelation({
      reservedByUserId: row.reserved_by_user_id,
      slotXUserId: row.x_user_id,
      authUserId: userId,
      activeXId: guard.activeXId,
    });
    if (!canActAsSlotSubmitter(relation)) {
      return { ok: false, message: SLOT_SUBMIT_REJECT_MESSAGE };
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const previousIconUrl = existingVideo?.creator_icon_url ?? null;
  const iconResolved = await resolveVideoCreatorIcon({
    formData,
    parsed: parsed.data,
    activeXId: activeX,
    videoId,
    existingIconUrl: previousIconUrl,
    db,
  });
  if (!iconResolved.ok) return iconResolved;

  const displayName =
    parsed.data.display_name ||
    slotRow.display_name ||
    activeX ||
    sessionUser.name ||
    "anonymous";
  const videoAfter: typeof videos.$inferSelect = existingVideo
    ? {
        ...existingVideo,
        title: parsed.data.title,
        // フィールド未送信時だけ既存IDを維持し、明示的な空送信では解除する。
        youtube_video_id: youtubeFieldPresent
          ? submittedYoutubeId
          : existingVideo.youtube_video_id,
        creator_x_user_id: activeX,
        creator_display_name: parsed.data.display_name,
        creator_display_name_yomi:
          parsed.data.display_name !== existingVideo.creator_display_name
            ? null
            : existingVideo.creator_display_name_yomi,
        creator_icon_url: iconResolved.value.iconUrl,
        creator_youtube_channel_url: youtubeChannelFieldPresent
          ? snapshotYoutubeChannelUrl(parsed.data.youtube_channel_url)
          : existingVideo.creator_youtube_channel_url,
        creator_profile_text: profileFieldPresent
          ? parsed.data.profile_text ?? null
          : existingVideo.creator_profile_text,
        creator_other_social_links: socialLinksFieldPresent
          ? normalizeSocialLinksForStorage(parsed.data.other_social_links)
          : existingVideo.creator_other_social_links,
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
        creator_icon_url: iconResolved.value.iconUrl,
        creator_youtube_channel_url: snapshotYoutubeChannelUrl(parsed.data.youtube_channel_url),
        creator_profile_text: parsed.data.profile_text ?? null,
        creator_other_social_links: normalizeSocialLinksForStorage(
          parsed.data.other_social_links,
        ),
        title: parsed.data.title,
        music: parsed.data.music ?? null,
        credit: parsed.data.credit ?? null,
        music_reference_url: parsed.data.music_reference_url ?? null,
        closing_comment: parsed.data.closing_comment ?? null,
        youtube_video_id: submittedYoutubeId,
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

  let staticRebuildEnqueued = false;
  try {
    const plan = emptyVideoAtomicWritePlan();
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
    if (youtubeFieldPresent && submittedYoutubeId) {
      appendVideoAtomicWritePlan(plan, await buildVideoDerivedRowsPlan(db, {
        videoId, youtubeVideoId: submittedYoutubeId, now, actorUserId: userId,
      }));
    } else if (existingVideo && youtubeFieldPresent) {
      appendVideoAtomicWritePlan(plan, await buildVideoMetadataClearPlan(db, {
        videoId, now, actorUserId: userId,
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
    const rowsNeedingXAdoption = submittedSlots.filter(
      (row) =>
        groupIdentity.adoptNullRows &&
        row.x_user_id === null &&
        groupIdentity.targetXId !== null,
    );
    const bulkSubmitRows = submittedSlots.filter(
      (row) => !rowsNeedingXAdoption.some((candidate) => candidate.id === row.id),
    );

    for (const row of rowsNeedingXAdoption) {
      const adoptedXUserId = groupIdentity.targetXId;
      const after = {
        ...row,
        status: "submitted" as const,
        video_id: videoId,
        x_user_id: adoptedXUserId,
        updated_at: now,
        version: row.version + 1,
      };
      plan.statements.push(db.update(slots).set({
        status: after.status,
        video_id: after.video_id,
        x_user_id: after.x_user_id,
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

    if (bulkSubmitRows.length > 0) {
      plan.statements.push(
        db.update(slots).set({
          status: "submitted",
          video_id: videoId,
          updated_at: now,
          version: sql`${slots.version} + 1`,
        }).where(
          versionedSlotWhere(slotRow.event_id, bulkSubmitRows, "reserved"),
        ),
      );
      plan.expectedChanges.push(bulkSubmitRows.length);
      for (const row of bulkSubmitRows) {
        const after = {
          ...row,
          status: "submitted" as const,
          video_id: videoId,
          updated_at: now,
          version: row.version + 1,
        };
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
    }

    let notificationWakeSource: "web" | undefined;
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
        plan.expectedChanges.push(null);
        notificationWakeSource = "web";
      }
      const { buildChannelVideoRegisteredNotification } = await import(
        "@/lib/notifications/templates/video"
      );
      const { buildVideoRegisteredOpsThreadName } = await import(
        "@/lib/notifications/templates/video"
      );
      const { resolveNotificationActor } = await import(
        "@/lib/notifications/actor"
      );
      const { buildOpsChannelWebhookStatement } = await import(
        "@/lib/notifications/opsWebhook"
      );
      const actor = await resolveNotificationActor(db, userId);
      const channelNotification = await buildOpsChannelWebhookStatement(db, {
        target: "event",
        threadName: buildVideoRegisteredOpsThreadName(parsed.data.title, actor),
        actorUserId: userId,
        payload: buildChannelVideoRegisteredNotification({
          videoId,
          videoTitle: parsed.data.title,
          youtubeVideoId: submittedYoutubeId,
          registrationKind: "slot",
          eventId: slotRow.event_id,
          eventTitle: eventConfig.title ?? "イベント",
          actor,
          creatorDisplayName: displayName,
        }),
        dedupeKey: `channel_video_registered:${videoId}`,
        eventId: slotRow.event_id,
      });
      if (channelNotification) {
        plan.statements.push(channelNotification.statement);
        plan.expectedChanges.push(null);
        notificationWakeSource = "web";
      }
    }
    const isPublicResubmit = existingVideo?.visibility_status === "public";
    const rebuildReason = existingVideo ? "video_update" : "video_create";
    const rebuildEventIds = syncedEventIds.slice(0, MAX_SUBMIT_SLOT_REBUILD_EVENT_TARGETS);
    const rebuildTargets: EnqueueStaticRebuildInput[] = [
      {
        targetType: "video",
        targetId: videoId,
        reason: rebuildReason,
        priority: "high",
        requestedByUserId: userId,
      },
      // 新規提出・再提出ともメンバー/クリエイター履歴を書き換え得る。
      { targetType: "member_suggestions", targetId: "global", reason: rebuildReason },
      ...rebuildEventIds.flatMap((eventId) => [
        {
          targetType: "event_base" as const,
          targetId: eventId,
          reason: "video_submit",
          priority: "high" as const,
        },
        {
          targetType: "event_slots" as const,
          targetId: eventId,
          reason: "video_submit",
          priority: "high" as const,
        },
        {
          targetType: "event_release" as const,
          targetId: eventId,
          reason: "video_submit",
          priority: "high" as const,
        },
      ]),
      topSlotStatsGlobalTarget("video_submit", "normal"),
    ];
    if (isPublicResubmit) {
      rebuildTargets.push(
        { targetType: "list_recent", targetId: "global", reason: "video_submit" },
        { targetType: "list_popular", targetId: "global", reason: "video_submit" },
        { targetType: "search_index", targetId: "global", reason: "video_submit" },
        { targetType: "users_index", targetId: "global", reason: "video_submit" },
        {
          targetType: "random_video_pool",
          targetId: "global",
          reason: "video_card_update",
          priority: "low",
          requestedByUserId: userId,
        },
        { targetType: "user", targetId: activeX, reason: "video_submit" },
        ...topVideoVisibilityTargets("video_submit"),
      );
    }
    const queue = await buildStaticRebuildQueueBatch(db, rebuildTargets);
    staticRebuildEnqueued = queue.statements.length > 0;
    plan.statements.push(...queue.statements);
    plan.expectedChanges.push(...queue.expectedChanges);
    const wakeSentKinds = new Set<QueueWakeKind>();
    await executeVideoAtomicWritePlan(db, plan, {
      notificationWakeSource,
      staticRebuildWakeSource: queue.statements.length > 0 ? "web" : undefined,
      wakeSentKinds,
    });
    if (youtubeFieldPresent && submittedYoutubeId) {
      await sendYoutubeSyncPendingWakeBestEffort("web", wakeSentKinds);
    }
  } catch (error) {
    unstable_rethrow(error);
    await rollbackUploadedVideoIcon(iconResolved.value.uploadedKey);
    if (isYoutubeIdUniqueConstraintError(error)) {
      return { ok: false, message: "このYouTube動画は既に登録されています。" };
    }
    console.warn("[submitSlotVideo] atomic save rejected", error);
    return { ok: false, message: "保存対象が多すぎるか競合が発生しました。再読み込みして再試行してください。" };
  }

  const traceId = createTraceId();
  await runPostCommitBestEffort(
    { flow: "submit_slot_video", traceId },
    [
      {
        name: "revalidate",
        run: async () => {
          revalidatePath("/");
          revalidatePath(`/event/${slotRow.event_id}`);
          revalidatePath(`/event/${slotRow.event_id}/slots`);
          revalidatePath("/dashboard");
        },
      },
      {
        name: "icon_orphan_cleanup",
        run: async () => {
          await cleanupReplacedVideoCreatorIcon(
            db,
            previousIconUrl,
            iconResolved.value.iconUrl,
          );
        },
      },
    ],
  );
  return markPendingPublicReflection(
    {
      ok: true,
      videoId,
      youtubeVideoId: submittedYoutubeId ?? undefined,
      eventId: slotRow.event_id,
    },
    staticRebuildEnqueued,
  );
}

const SLOT_SUBMIT_UNEXPECTED_ERROR_MESSAGE =
  "枠への投稿処理で一時的なエラーが発生しました。ページを再読み込みしてから、もう一度お試しください。";

/**
 * Keep read/preflight failures inside the Server Action result contract.
 * D1/R2/network failures before the atomic-save try block must not escape to
 * React's action transport, which otherwise collapses them into a generic
 * client-side submission error and gives the user no retryable result.
 */
export async function submitSlotVideo(
  formData: FormData,
): Promise<VideoActionResult> {
  try {
    return await submitSlotVideoCore(formData);
  } catch (error) {
    unstable_rethrow(error);
    console.warn("[submitSlotVideo] preflight rejected", error);
    return {
      ok: false,
      message: SLOT_SUBMIT_UNEXPECTED_ERROR_MESSAGE,
    };
  }
}
