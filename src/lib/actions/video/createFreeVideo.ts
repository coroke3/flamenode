"use server";

import { auditAction } from "@/lib/audit/helpers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import { videos } from "@/lib/db/schema";
import { extractYoutubeId } from "@/lib/youtube/id";
import { generateId } from "@/lib/utils/id";
import { recordYoutubeChannelCandidateFromVideo, snapshotYoutubeChannelUrl } from "@/lib/db/youtubeChannelCandidates";
import { normalizeXId } from "@/lib/utils/xid";
import { replaceVideoSoftwareLabels } from "@/lib/db/software";
import { shouldEnqueueUserNotification } from "@/lib/notifications/context";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { buildFreeVideoSubmittedNotification } from "@/lib/notifications/templates/video";
import { parseVideoForm } from "@/lib/video/videoFormSchema";
import { parseEventIdsFromForm } from "@/lib/video/parseEventIds";
import {
  buildStagePermissionSubmission,
  getStagePermissionFieldsForEvents,
} from "@/lib/video/stagePermissionSubmission";
import { ensureSubmissionXUser } from "@/lib/video/ensureSubmissionXUser";
import {
  ensureVideoDerivedRows,
  resolveEventSyncTargetForNewVideo,
  syncVideoEvents,
} from "@/lib/video/syncVideoEvents";
import { replaceVideoMembers } from "@/lib/video/replaceVideoMembers";
import { recordXIconCandidateFromVideo } from "@/lib/video/iconCandidate";
import { isYoutubeIdUniqueConstraintError } from "@/lib/video/youtubeDuplicate";
import { checkYoutubeVideoDuplicate } from "@/lib/video/slotPart";
import {
  validateCustomAnswersForEvents,
  validateVideoMemberSubmission,
} from "@/lib/video/submissionValidation";
import { replaceStagePermissionCustomAnswers } from "@/lib/video/stagePermissionAnswers";
import { replaceGeneralCustomAnswers } from "@/lib/video/customQuestionAnswers";
import type { VideoActionResult } from "@/lib/video/types";

export async function createFreeVideo(
  formData: FormData,
): Promise<VideoActionResult> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "post_video_unslotted",
  });
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
  const sessionUser = guard.user;
  const userId = sessionUser.id;
  const approvedXIds = guard.approvedXIds;

  const parsed = parseVideoForm(Object.fromEntries(formData));
  if (!parsed.ok) return parsed;
  const youtubeId = extractYoutubeId(parsed.data.youtube_url);
  if (!youtubeId) {
    return { ok: false, message: "YouTube URL が解析できません。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const activeX = normalizeXId(sessionUser.active_x_user_id);
  if (!activeX || !approvedXIds.includes(activeX)) {
    return { ok: false, message: "承認済みの X ID を選択してください。" };
  }

  const requestedEventIds = parseEventIdsFromForm(formData);
  const stageFields = await getStagePermissionFieldsForEvents(db, requestedEventIds);
  const stagePermissionResult = buildStagePermissionSubmission(
    formData,
    stageFields,
  );
  if (!stagePermissionResult.ok) return stagePermissionResult;
  const stagePermission = stagePermissionResult.value;

  if (await checkYoutubeVideoDuplicate(db, youtubeId)) {
    return { ok: false, message: "この YouTube 動画は既に登録されています。" };
  }

  const memberValidation = validateVideoMemberSubmission(
    formData,
    parsed.data.is_collab ?? false,
  );
  if (!memberValidation.ok) return memberValidation;

  const syncedEventIds = await resolveEventSyncTargetForNewVideo(db, {
    requested: requestedEventIds,
    user: { id: userId, role: sessionUser.role ?? null },
    linkPolicy: "unslotted_posts",
  });
  if (
    sessionUser.role !== "admin" &&
    requestedEventIds.some((id) => !syncedEventIds.includes(id))
  ) {
    return {
      ok: false,
      message:
        "選択したイベントの一部は枠なし投稿の紐づけを受け付けていません。",
    };
  }
  const customValidation = await validateCustomAnswersForEvents(
    db,
    formData,
    syncedEventIds,
  );
  if (!customValidation.ok) return customValidation;

  const id = generateId("v");
  const now = Math.floor(Date.now() / 1000);
  const displayName = parsed.data.display_name;
  const iconUrl = parsed.data.icon_url || null;

  await ensureSubmissionXUser(db, {
    xId: activeX,
    displayName,
    profileText: parsed.data.profile_text ?? null,
    youtubeChannelUrl: parsed.data.youtube_channel_url ?? null,
    socialLinks: parsed.data.other_social_links ?? null,
    allowProfileUpdate: true,
  });

  try {
    await db.insert(videos).values({
      id,
      submitted_by_discord_user_id: userId,
      creator_x_user_id: activeX || null,
      collaboration_type: parsed.data.is_collab ? "collab" : "individual",
      source_type: "youtube",
      creator_display_name: displayName,
      title: parsed.data.title,
      youtube_video_id: youtubeId,
      creator_icon_url: iconUrl,
      creator_youtube_channel_url: snapshotYoutubeChannelUrl(
        parsed.data.youtube_channel_url,
      ),
      visibility_status: "public",
      music: parsed.data.music ?? null,
      music_reference_url: parsed.data.music_reference_url ?? null,
      credit: parsed.data.credit ?? null,
      intro_comment: parsed.data.intro_comment ?? null,
      highlights: parsed.data.highlights ?? null,
      production_story: parsed.data.production_story ?? null,
      closing_comment: parsed.data.closing_comment ?? null,
      part: parsed.data.part?.trim() || null,
      primary_event_id: syncedEventIds[0] ?? null,
      scheduling_type: "manual",
      scheduled_time: now,
      created_at: now,
      updated_at: now,
    });
  } catch (err) {
    if (isYoutubeIdUniqueConstraintError(err)) {
      return { ok: false, message: "この YouTube 動画は既に登録されています。" };
    }
    throw err;
  }

  await ensureVideoDerivedRows(db, { videoId: id, youtubeVideoId: youtubeId, now });
  await replaceVideoMembers(
    db,
    id,
    memberValidation.value.members,
    memberValidation.value.chaptersByIndex,
  );
  await replaceVideoSoftwareLabels(db, id, parsed.data.used_software ?? null);

  await syncVideoEvents(db, id, {
    requested: requestedEventIds,
    user: { id: userId, role: sessionUser.role ?? null },
    linkPolicy: "unslotted_posts",
  });
  await replaceStagePermissionCustomAnswers(db, {
    videoId: id,
    eventIds: syncedEventIds,
    stagePermission,
    now,
  });
  await replaceGeneralCustomAnswers(db, {
    videoId: id,
    eventIds: syncedEventIds,
    drafts: customValidation.drafts,
    now,
  });

  await recordXIconCandidateFromVideo(db, { xUserId: activeX, iconUrl, videoId: id });
  await recordYoutubeChannelCandidateFromVideo(db, {
    xUserId: activeX,
    youtubeChannelUrl: parsed.data.youtube_channel_url ?? null,
    videoId: id,
  });

  await auditAction(db, {
    table_name: "videos",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({ title: parsed.data.title, youtube_video_id: youtubeId }),
    operator_discord_id: userId,
    retention_class: "normal",
  });

  revalidatePath("/");
  revalidatePath("/list");
  revalidatePath("/dashboard");
  const { enqueueAfterVideoCreate } = await import("@/lib/staticRebuild/hooks");
  await enqueueAfterVideoCreate(db, {
    videoId: id,
    creatorXUserId: activeX || null,
    primaryEventId: syncedEventIds[0] ?? null,
    eventIds: syncedEventIds,
    requestedByUserId: userId,
  });

  if (shouldEnqueueUserNotification()) {
    await enqueueNotification(db, {
      discordUserId: userId,
      type: "video_submitted",
      dedupeKey: `video_submitted:${id}`,
      payload: buildFreeVideoSubmittedNotification({
        videoId: id,
        videoTitle: parsed.data.title,
        youtubeVideoId: youtubeId,
        hasLinkedEvent: requestedEventIds.length > 0,
      }),
      eventId: syncedEventIds[0] ?? null,
    });
  }

  return { ok: true, videoId: id, youtubeVideoId: youtubeId };
}
