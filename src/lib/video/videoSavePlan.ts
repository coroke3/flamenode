import { auditAction } from "@/lib/audit/helpers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { videos, videoEvents } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { recordYoutubeChannelCandidateFromVideo } from "@/lib/db/youtubeChannelCandidates";
import { replaceVideoSoftwareLabels } from "@/lib/db/software";
import type { CanEditVideoPrivilegeMode } from "@/lib/auth/ownership";
import { ensurePrimaryEventInVideoEvents } from "@/lib/video/primaryEventLink";
import { ensureSubmissionXUser } from "@/lib/video/ensureSubmissionXUser";
import { ensureVideoDerivedRows, syncVideoEvents } from "@/lib/video/syncVideoEvents";
import { replaceVideoMembers } from "@/lib/video/replaceVideoMembers";
import { recordXIconCandidateFromVideo } from "@/lib/video/iconCandidate";
import {
  replaceStagePermissionCustomAnswers,
  readStagePermissionCustomAnswers,
} from "@/lib/video/stagePermissionAnswers";
import type { CustomAnswerDraft } from "@/lib/video/customQuestions";
import { replaceGeneralCustomAnswers } from "@/lib/video/customQuestionAnswers";
import { parseEventIdsFromForm } from "@/lib/video/parseEventIds";
import type { VideoFormData } from "@/lib/video/videoFormSchema";
import type { AllowedVideoEditSections } from "@/lib/video/computeEditSections";
import type { ValidatedMemberSubmission } from "@/lib/video/submissionValidation";
import { computeStagePermissionAnswerDeleteEventIds } from "@/lib/video/eventSync";
import {
  computeStaticRebuildFlags,
  computeVideoRevalidatePaths,
} from "@/lib/video/computeRevalidateTargets";

import {
  buildVideoAuditSnapshot,
  type VideoAuditSnapshot,
} from "@/lib/video/videoSavePlanCore";

export interface VideoUpdatePayload {
  title: string;
  youtube_video_id: string | null;
  creator_x_user_id: string | null;
  creator_display_name: string | null;
  creator_icon_url: string | null;
  creator_youtube_channel_url: string | null;
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
  youtubeId: string;
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
  profileText: string | null;
  youtubeChannelUrl: string | null;
  socialLinks: string | null;
}

export function buildVideoUpdatePayload(args: {
  target: typeof videos.$inferSelect;
  parsed: VideoFormData;
  youtubeId: string;
  nextCreatorX: string;
  allowSubmitterChange: boolean;
  sections: AllowedVideoEditSections;
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
    now,
    creatorYoutubeChannelUrl,
  } = args;
  return {
    title: sections.basics ? parsed.title : target.title,
    youtube_video_id: sections.youtube ? youtubeId : target.youtube_video_id,
    creator_x_user_id: allowSubmitterChange ? nextCreatorX || null : target.creator_x_user_id,
    creator_display_name: sections.identity ? parsed.display_name : target.creator_display_name,
    creator_icon_url: sections.identity ? parsed.icon_url || null : target.creator_icon_url,
    creator_youtube_channel_url: sections.identity
      ? creatorYoutubeChannelUrl
      : target.creator_youtube_channel_url,
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
  youtubeId: string;
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
      canEditPrimaryEvent: args.sections.primary_event,
      hasEventIdsField: args.hasEventIdsField,
    }),
    primaryEventId: args.target.primary_event_id,
    previousYoutubeVideoId: args.target.youtube_video_id,
    profileText: args.parsed.profile_text ?? null,
    youtubeChannelUrl: args.parsed.youtube_channel_url ?? null,
    socialLinks: args.parsed.other_social_links ?? null,
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

export async function writeVideoAudit(db: DB, plan: VideoSavePlan): Promise<void> {
  await auditAction(db, {
    table_name: "videos",
    record_id: plan.videoId,
    action: "UPDATE",
    before_data: JSON.stringify(plan.auditBefore),
    after_data: JSON.stringify({
      sections: {
        identity: plan.sections.identity,
        basics: plan.sections.basics,
        youtube: plan.sections.youtube,
        credits: plan.sections.credits,
        descriptions: plan.sections.descriptions,
        members: plan.sections.members,
      },
      privilege_mode: plan.privilegeMode,
      allow_submitter_change: plan.allowSubmitterChange,
      ...plan.auditAfter,
    }),
    operator_user_id: plan.operatorUserId,
    retention_class: "normal",
  });
}

export async function applyVideoUpdatePlan(
  db: DB,
  plan: VideoSavePlan,
  args: {
    approvedXIds: string[];
    sessionRole: string | null | undefined;
    formData: FormData;
  },
): Promise<void> {
  const { payload, sections } = plan;
  let syncedEventIds = plan.syncedEventIds;

  if (sections.identity) {
    await ensureSubmissionXUser(db, {
      xId: plan.nextCreatorX,
      displayName: payload.creator_display_name ?? "",
      profileText: plan.profileText,
      youtubeChannelUrl: plan.youtubeChannelUrl,
      socialLinks: plan.socialLinks,
      allowProfileUpdate:
        args.sessionRole === "admin" || args.approvedXIds.includes(plan.nextCreatorX),
    });
  }

  await db
    .update(videos)
    .set(payload as Partial<typeof videos.$inferInsert>)
    .where(eq(videos.id, plan.videoId));

  if (sections.youtube) {
    await ensureVideoDerivedRows(db, {
      videoId: plan.videoId,
      youtubeVideoId: plan.youtubeId,
      now: payload.updated_at,
    });
  }

  if (sections.descriptions) {
    await replaceVideoSoftwareLabels(db, plan.videoId, plan.usedSoftware);
  }

  if (sections.members && plan.memberSubmission) {
    await replaceVideoMembers(
      db,
      plan.videoId,
      plan.memberSubmission.members,
      plan.memberSubmission.chaptersByIndex,
    );
  }

  if (sections.primary_event && args.formData.has("event_ids")) {
    const requestedEventIds = parseEventIdsFromForm(args.formData);
    const alwaysInclude = plan.primaryEventId ? [plan.primaryEventId] : [];
    syncedEventIds = await syncVideoEvents(db, plan.videoId, {
      requested: requestedEventIds,
      alwaysInclude,
      user: { id: plan.operatorUserId, role: args.sessionRole ?? null },
    });
    if (plan.primaryEventId) {
      await ensurePrimaryEventInVideoEvents(db, plan.videoId, plan.primaryEventId);
    }
  }

  const currentEventIds =
    syncedEventIds ??
    (
      await db
        .select({ event_id: videoEvents.event_id })
        .from(videoEvents)
        .where(eq(videoEvents.video_id, plan.videoId))
    ).map((row) => row.event_id);

  if (sections.descriptions || plan.stagePermissionDeleteEventIds) {
    const preservedStagePermission = sections.descriptions
      ? plan.stagePermission
      : await readStagePermissionCustomAnswers(db, {
          videoId: plan.videoId,
          eventIds: currentEventIds,
        });
    await replaceStagePermissionCustomAnswers(db, {
      videoId: plan.videoId,
      eventIds: currentEventIds,
      deleteEventIds: plan.stagePermissionDeleteEventIds,
      stagePermission: preservedStagePermission,
      now: payload.updated_at,
    });
    await replaceGeneralCustomAnswers(db, {
      videoId: plan.videoId,
      eventIds: currentEventIds,
      drafts: plan.customAnswerDrafts,
      now: payload.updated_at,
    });
  }

  if (sections.identity) {
    await recordXIconCandidateFromVideo(db, {
      xUserId: plan.nextCreatorX,
      iconUrl: payload.creator_icon_url,
      videoId: plan.videoId,
    });
    await recordYoutubeChannelCandidateFromVideo(db, {
      xUserId: plan.nextCreatorX,
      youtubeChannelUrl: payload.creator_youtube_channel_url,
      videoId: plan.videoId,
    });
  }

  for (const path of plan.revalidatePaths) {
    revalidatePath(path);
  }

  const linkedEvents = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, plan.videoId));
  const eventIds = linkedEvents.map((r) => r.event_id);

  const { enqueueAfterVideoUpdate } = await import("@/lib/staticRebuild/hooks");
  await enqueueAfterVideoUpdate(db, {
    videoId: plan.videoId,
    creatorXUserId: plan.allowSubmitterChange
      ? plan.nextCreatorX || null
      : payload.creator_x_user_id,
    primaryEventId: plan.primaryEventId,
    eventIds,
    visibilityChanged: false,
    identityChanged: plan.rebuildFlags.identityChanged,
    eventMembershipChanged: plan.rebuildFlags.eventMembershipChanged,
    requestedByUserId: plan.operatorUserId,
  });

  await writeVideoAudit(db, plan);
}
