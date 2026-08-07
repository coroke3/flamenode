import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { videos, videoEvents } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { buildReplaceVideoSoftwarePlan } from "@/lib/db/software";
import type { CanEditVideoPrivilegeMode } from "@/lib/auth/ownership";
import { normalizeSocialLinksForStorage } from "@/lib/socialLinks";
import {
  buildSyncVideoEventsPlan,
  buildVideoDerivedRowsPlan,
  buildVideoMetadataClearPlan,
  MAX_ATOMIC_VIDEO_EVENTS,
} from "@/lib/video/syncVideoEvents";
import { buildReplaceVideoMembersPlan } from "@/lib/video/replaceVideoMembers";
import {
  buildReplaceStagePermissionAnswersPlan,
  readStagePermissionCustomAnswers,
} from "@/lib/video/stagePermissionAnswers";
import type { CustomAnswerDraft } from "@/lib/video/customQuestions";
import { buildReplaceGeneralCustomAnswersPlan } from "@/lib/video/customQuestionAnswers";
import type { VideoFormData } from "@/lib/video/videoFormSchema";
import type { AllowedVideoEditSections } from "@/lib/video/computeEditSections";
import type { ValidatedMemberSubmission } from "@/lib/video/submissionValidation";
import { computeStagePermissionAnswerDeleteEventIds } from "@/lib/video/eventSync";
import {
  computeStaticRebuildFlags,
  computeVideoRevalidatePaths,
} from "@/lib/video/computeRevalidateTargets";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import {
  appendVideoAtomicWritePlan,
  emptyVideoAtomicWritePlan,
  executeVideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { buildVideoCardChangeFanOutTargets } from "@/lib/staticRebuild/hooks";
import type { EnqueueStaticRebuildInput } from "@/lib/staticRebuild/types";
import { sendYoutubeSyncPendingWakeBestEffort } from "@/lib/queues/youtubeSyncWake";
import type { QueueWakeKind } from "@/lib/queues/wakeBudget";

import {
  buildVideoAuditSnapshot,
  type VideoAuditSnapshot,
} from "@/lib/video/videoSavePlanCore";

export interface VideoUpdatePayload {
  title: string;
  youtube_video_id: string | null;
  creator_x_user_id: string | null;
  creator_display_name: string | null;
  creator_display_name_yomi: string | null;
  creator_icon_url: string | null;
  creator_youtube_channel_url: string | null;
  creator_profile_text: string | null;
  creator_other_social_links: string | null;
  music: string | null;
  music_reference_url: string | null;
  credit: string | null;
  intro_comment: string | null;
  highlights: string | null;
  production_story: string | null;
  closing_comment: string | null;
  collaboration_type: string;
  part: string | null;
  updated_at: number;
}

export interface VideoSavePlan {
  videoId: string;
  operatorUserId: string;
  privilegeMode: CanEditVideoPrivilegeMode;
  allowSubmitterChange: boolean;
  sections: AllowedVideoEditSections;
  payload: VideoUpdatePayload;
  youtubeId: string | null;
  youtubeChanged: boolean;
  nextCreatorX: string;
  usedSoftware: string | null;
  stagePermission: string | null;
  memberSubmission: ValidatedMemberSubmission | null;
  customAnswerDrafts: CustomAnswerDraft[];
  syncedEventIds: string[] | null;
  stagePermissionDeleteEventIds: string[] | undefined;
  auditBefore: VideoAuditSnapshot;
  auditAfter: VideoAuditSnapshot;
  revalidatePaths: string[];
  rebuildFlags: ReturnType<typeof computeStaticRebuildFlags>;
  primaryEventId: string | null;
  previousYoutubeVideoId: string | null;
  target: typeof videos.$inferSelect;
}

export function buildVideoUpdatePayload(args: {
  target: typeof videos.$inferSelect;
  parsed: VideoFormData;
  youtubeId: string | null;
  nextCreatorX: string;
  allowSubmitterChange: boolean;
  sections: AllowedVideoEditSections;
  privilegeMode: CanEditVideoPrivilegeMode;
  now: number;
  creatorYoutubeChannelUrl: string | null;
}): VideoUpdatePayload {
  const {
    target,
    parsed,
    youtubeId,
    nextCreatorX,
    allowSubmitterChange,
    sections,
    privilegeMode,
    now,
    creatorYoutubeChannelUrl,
  } = args;
  const displayNameChanged =
    sections.identity && parsed.display_name !== target.creator_display_name;
  return {
    title: sections.basics ? parsed.title : target.title,
    youtube_video_id: sections.youtube ? youtubeId : target.youtube_video_id,
    creator_x_user_id: allowSubmitterChange ? nextCreatorX || null : target.creator_x_user_id,
    creator_display_name: sections.identity ? parsed.display_name : target.creator_display_name,
    creator_display_name_yomi: sections.identity
      ? displayNameChanged
        ? null
        : target.creator_display_name_yomi
      : target.creator_display_name_yomi,
    creator_icon_url: sections.identity ? parsed.icon_url || null : target.creator_icon_url,
    creator_youtube_channel_url:
      sections.identity && privilegeMode !== "normal"
      ? creatorYoutubeChannelUrl
      : target.creator_youtube_channel_url,
    creator_profile_text:
      sections.identity && privilegeMode !== "normal"
      ? parsed.profile_text ?? null
      : target.creator_profile_text,
    creator_other_social_links:
      sections.identity && privilegeMode !== "normal"
      ? normalizeSocialLinksForStorage(parsed.other_social_links)
      : target.creator_other_social_links,
    music: sections.credits ? parsed.music ?? null : target.music,
    music_reference_url: sections.credits
      ? parsed.music_reference_url ?? null
      : target.music_reference_url,
    credit: sections.credits ? parsed.credit ?? null : target.credit,
    intro_comment: sections.descriptions
      ? parsed.intro_comment ?? null
      : target.intro_comment,
    highlights: sections.descriptions ? parsed.highlights ?? null : target.highlights,
    production_story: sections.descriptions
      ? parsed.production_story ?? null
      : target.production_story,
    closing_comment: sections.descriptions
      ? parsed.closing_comment ?? null
      : target.closing_comment,
    collaboration_type: sections.members
      ? parsed.is_collab
        ? "collab"
        : "individual"
      : target.collaboration_type,
    part: sections.basics ? parsed.part?.trim() || null : target.part,
    updated_at: now,
  };
}

export function buildVideoUpdatePlan(args: {
  videoId: string;
  operatorUserId: string;
  privilegeMode: CanEditVideoPrivilegeMode;
  allowSubmitterChange: boolean;
  sections: AllowedVideoEditSections;
  target: typeof videos.$inferSelect;
  targetSoftwareLabel: string | null;
  parsed: VideoFormData;
  youtubeId: string | null;
  youtubeChanged: boolean;
  nextCreatorX: string;
  nextStagePermission: string | null;
  creatorYoutubeChannelUrl: string | null;
  memberSubmission: ValidatedMemberSubmission | null;
  customAnswerDrafts: VideoSavePlan["customAnswerDrafts"];
  syncedEventIds: string[] | null;
  stagePermissionDeleteEventIds: string[] | undefined;
  hasEventIdsField: boolean;
  now: number;
}): VideoSavePlan {
  const payload = buildVideoUpdatePayload({
    target: args.target,
    parsed: args.parsed,
    youtubeId: args.youtubeId,
    nextCreatorX: args.nextCreatorX,
    allowSubmitterChange: args.allowSubmitterChange,
    sections: args.sections,
    privilegeMode: args.privilegeMode,
    now: args.now,
    creatorYoutubeChannelUrl: args.creatorYoutubeChannelUrl,
  });

  const auditBefore = buildVideoAuditSnapshot(args.target, undefined, args.targetSoftwareLabel);
  const auditAfter = buildVideoAuditSnapshot(args.target, {
    title: payload.title,
    youtube_video_id: payload.youtube_video_id,
    creator_x_user_id: payload.creator_x_user_id,
    display_name: payload.creator_display_name,
    icon_url: payload.creator_icon_url,
    music: payload.music,
    music_reference_url: payload.music_reference_url,
    credit: payload.credit,
    intro_comment: payload.intro_comment,
    highlights: payload.highlights,
    production_story: payload.production_story,
    used_software: args.sections.descriptions
      ? args.parsed.used_software ?? null
      : args.targetSoftwareLabel,
    closing_comment: payload.closing_comment,
    collaboration_type: payload.collaboration_type,
    part: payload.part,
  });

  return {
    videoId: args.videoId,
    operatorUserId: args.operatorUserId,
    privilegeMode: args.privilegeMode,
    allowSubmitterChange: args.allowSubmitterChange,
    sections: args.sections,
    payload,
    youtubeId: args.youtubeId,
    youtubeChanged: args.youtubeChanged,
    nextCreatorX: args.nextCreatorX,
    usedSoftware: args.parsed.used_software ?? null,
    stagePermission: args.nextStagePermission,
    memberSubmission: args.memberSubmission,
    customAnswerDrafts: args.customAnswerDrafts,
    syncedEventIds: args.syncedEventIds,
    stagePermissionDeleteEventIds: args.stagePermissionDeleteEventIds,
    auditBefore,
    auditAfter,
    revalidatePaths: computeVideoRevalidatePaths({
      videoId: args.videoId,
      previousYoutubeVideoId: args.target.youtube_video_id,
      nextYoutubeVideoId: args.sections.youtube ? args.youtubeId : args.target.youtube_video_id,
      primaryEventId: args.target.primary_event_id,
      youtubeChanged: args.youtubeChanged,
    }),
    rebuildFlags: computeStaticRebuildFlags({
      canEditIdentity: args.sections.identity,
      allowSubmitterChange: args.allowSubmitterChange,
      displayNameChanged: args.parsed.display_name !== args.target.creator_display_name,
      iconChanged:
        (args.parsed.icon_url || null) !== (args.target.creator_icon_url || null),
      titleChanged: args.parsed.title !== args.target.title,
      youtubeChanged: args.youtubeChanged,
      canEditPrimaryEvent: args.sections.primary_event,
      hasEventIdsField: args.hasEventIdsField,
      membersSectionTouched:
        (args.sections.members || args.sections.member_chapters) &&
        Boolean(args.memberSubmission),
    }),
    primaryEventId: args.target.primary_event_id,
    previousYoutubeVideoId: args.target.youtube_video_id,
    target: { ...args.target },
  };
}

export function computeStagePermissionDeleteIds(args: {
  previousEventIds: string[];
  syncedEventIds: string[];
}): string[] {
  return computeStagePermissionAnswerDeleteEventIds({
    previousEventIds: args.previousEventIds,
    targetEventIds: args.syncedEventIds,
  });
}

export async function applyVideoUpdatePlan(
  db: DB,
  plan: VideoSavePlan,
): Promise<boolean> {
  const { payload, sections } = plan;
  const existingEventRows = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, plan.videoId))
    .limit(MAX_ATOMIC_VIDEO_EVENTS + 1);
  if (existingEventRows.length > MAX_ATOMIC_VIDEO_EVENTS) {
    throw new Error("video_event_existing_atomic_limit_exceeded");
  }
  const existingEventIds = existingEventRows.map((row) => row.event_id);
  const targetEventIds = plan.syncedEventIds ?? existingEventIds;
  const atomic = emptyVideoAtomicWritePlan();

  const after = { ...plan.target, ...payload };
  atomic.statements.push(db.update(videos)
    .set(payload as Partial<typeof videos.$inferInsert>)
    .where(and(
      eq(videos.id, plan.videoId),
      expectedRowCondition({ expectedCurrent: plan.target }),
    )!));
  atomic.expectedChanges.push(1);
  atomic.audits.push({
    table_name: "videos",
    target_id: plan.videoId,
    operation: "UPDATE",
    before: { ...plan.target },
    after,
    actor_user_id: plan.operatorUserId,
    reason: `privilege:${plan.privilegeMode}`,
    context: "video-save:update",
    retention_class: "normal",
    strict: true,
  });

  if (sections.youtube && plan.youtubeChanged) {
    if (plan.youtubeId) {
      appendVideoAtomicWritePlan(atomic, await buildVideoDerivedRowsPlan(db, {
        videoId: plan.videoId,
        youtubeVideoId: plan.youtubeId,
        now: payload.updated_at,
        actorUserId: plan.operatorUserId,
      }));
    } else {
      appendVideoAtomicWritePlan(atomic, await buildVideoMetadataClearPlan(db, {
        videoId: plan.videoId,
        now: payload.updated_at,
        actorUserId: plan.operatorUserId,
      }));
    }
  }
  if (sections.descriptions) {
    appendVideoAtomicWritePlan(atomic, await buildReplaceVideoSoftwarePlan(db, {
      videoId: plan.videoId,
      raw: plan.usedSoftware,
      actorUserId: plan.operatorUserId,
    }));
  }
  if ((sections.members || sections.member_chapters) && plan.memberSubmission) {
    appendVideoAtomicWritePlan(atomic, await buildReplaceVideoMembersPlan(db, {
      videoId: plan.videoId,
      members: plan.memberSubmission.members,
      chaptersByIndex: plan.memberSubmission.chaptersByIndex,
      actorUserId: plan.operatorUserId,
    }));
  }
  if (plan.syncedEventIds) {
    appendVideoAtomicWritePlan(atomic, await buildSyncVideoEventsPlan(db, plan.videoId, {
      targetEventIds,
      actorUserId: plan.operatorUserId,
    }));
  }
  if (sections.descriptions || plan.stagePermissionDeleteEventIds) {
    const stagePermission = sections.descriptions
      ? plan.stagePermission
      : await readStagePermissionCustomAnswers(db, {
          videoId: plan.videoId,
          eventIds: targetEventIds,
        });
    appendVideoAtomicWritePlan(atomic, await buildReplaceStagePermissionAnswersPlan(db, {
      videoId: plan.videoId,
      eventIds: targetEventIds,
      deleteEventIds: plan.stagePermissionDeleteEventIds,
      stagePermission,
      now: payload.updated_at,
      actorUserId: plan.operatorUserId,
    }));
    appendVideoAtomicWritePlan(atomic, await buildReplaceGeneralCustomAnswersPlan(db, {
      videoId: plan.videoId,
      eventIds: targetEventIds,
      drafts: plan.customAnswerDrafts,
      now: payload.updated_at,
      actorUserId: plan.operatorUserId,
    }));
  }
  const queueItems: EnqueueStaticRebuildInput[] = [{
    targetType: "video",
    targetId: plan.videoId,
    reason: "video_update",
    requestedByUserId: plan.operatorUserId,
  }];
  if (plan.rebuildFlags.creatorAggregationChanged && plan.memberSubmission) {
    const affectedCreatorIds = new Set(
      [
        plan.target.creator_x_user_id,
        ...plan.memberSubmission.members
          .map((member) => member.x_user_id?.trim())
          .filter((id): id is string => Boolean(id)),
      ].filter((id): id is string => Boolean(id)),
    );

    for (const creatorXUserId of affectedCreatorIds) {
      queueItems.push({
        targetType: "user",
        targetId: creatorXUserId,
        reason: "video_members_update",
        requestedByUserId: plan.operatorUserId,
      });
    }

    queueItems.push({
      targetType: "users_index",
      targetId: "global",
      reason: "video_members_update",
      requestedByUserId: plan.operatorUserId,
    });
  }
  if (plan.rebuildFlags.identityChanged) {
    const affectedCreatorIds = new Set(
      [
        plan.target.creator_x_user_id,
        payload.creator_x_user_id,
      ].filter((id): id is string => Boolean(id)),
    );

    for (const creatorXUserId of affectedCreatorIds) {
      queueItems.push({
        targetType: "user",
        targetId: creatorXUserId,
        reason: "video_identity_update",
        requestedByUserId: plan.operatorUserId,
      });
    }

    if (affectedCreatorIds.size > 0) {
      queueItems.push({
        targetType: "users_index",
        targetId: "global",
        reason: "video_identity_update",
        requestedByUserId: plan.operatorUserId,
      });
    }

    queueItems.push({
      targetType: "search_index",
      targetId: "global",
      reason: "video_identity_update",
      requestedByUserId: plan.operatorUserId,
    });
  }
  if (plan.rebuildFlags.eventMembershipChanged) {
    for (const eventId of new Set([plan.primaryEventId, ...existingEventIds, ...targetEventIds])) {
      if (!eventId) continue;
      queueItems.push({
        targetType: "event",
        targetId: eventId,
        reason: "video_update",
        requestedByUserId: plan.operatorUserId,
      });
    }
  }
  if (plan.rebuildFlags.randomPoolCardChanged) {
    queueItems.push({
      targetType: "random_video_pool",
      targetId: "global",
      reason: "video_card_changed",
      requestedByUserId: plan.operatorUserId,
      priority: "low",
    });
    const chainsTopRecommendViaUsersIndex =
      plan.rebuildFlags.creatorAggregationChanged ||
      (plan.rebuildFlags.identityChanged &&
        Boolean(plan.target.creator_x_user_id || payload.creator_x_user_id));
    queueItems.push(
      ...buildVideoCardChangeFanOutTargets({
        reason: "video_card_changed",
        requestedByUserId: plan.operatorUserId,
        priority: "low",
        skipTopRecommend: chainsTopRecommendViaUsersIndex,
      }),
    );
  }
  const queue = await buildStaticRebuildQueueBatch(db, queueItems);
  atomic.statements.push(...queue.statements);
  atomic.expectedChanges.push(...queue.expectedChanges);
  const wakeSentKinds = new Set<QueueWakeKind>();
  await executeVideoAtomicWritePlan(db, atomic, {
    staticRebuildWakeSource: queue.statements.length > 0 ? "web" : undefined,
    wakeSentKinds,
  });

  await runPostCommitBestEffort(
    { flow: "video.update" },
    [
      ...(sections.youtube && plan.youtubeChanged && plan.youtubeId
        ? [
            {
              name: "youtube_sync_wake",
              run: async () => {
                await sendYoutubeSyncPendingWakeBestEffort("web", wakeSentKinds);
              },
            },
          ]
        : []),
      {
        name: "revalidate",
        run: async () => {
          for (const path of plan.revalidatePaths) revalidatePath(path);
        },
      },
    ],
  );
  return queue.statements.length > 0;
}
