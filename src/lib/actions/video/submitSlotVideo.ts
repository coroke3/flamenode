"use server";

import { auditAction } from "@/lib/audit/helpers";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, or } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import { events as eventsTable, slots, videos, xUsers } from "@/lib/db/schema";
import { extractYoutubeId } from "@/lib/youtube/id";
import { generateId } from "@/lib/utils/id";
import { recordYoutubeChannelCandidateFromVideo, snapshotYoutubeChannelUrl } from "@/lib/db/youtubeChannelCandidates";
import { normalizeXId } from "@/lib/utils/xid";
import { replaceVideoSoftwareLabels } from "@/lib/db/software";
import { shouldEnqueueUserNotification } from "@/lib/notifications/context";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { buildSlotVideoSubmittedNotification } from "@/lib/notifications/templates/slot";
import { ensurePrimaryEventInVideoEvents } from "@/lib/video/primaryEventLink";
import { parseVideoForm } from "@/lib/video/videoFormSchema";
import { parseEventIdsFromForm } from "@/lib/video/parseEventIds";
import {
  buildStagePermissionSubmission,
  getStagePermissionFieldsForEvents,
} from "@/lib/video/stagePermissionSubmission";
import { ensureSubmissionXUser } from "@/lib/video/ensureSubmissionXUser";
import { ensureVideoDerivedRows, syncVideoEvents } from "@/lib/video/syncVideoEvents";
import { replaceVideoMembers } from "@/lib/video/replaceVideoMembers";
import { recordXIconCandidateFromVideo } from "@/lib/video/iconCandidate";
import { isYoutubeIdUniqueConstraintError } from "@/lib/video/youtubeDuplicate";
import { checkYoutubeVideoDuplicate, resolvePartFromSlot } from "@/lib/video/slotPart";
import {
  validateCustomAnswersForEvents,
  validateVideoMemberSubmission,
} from "@/lib/video/submissionValidation";
import { replaceStagePermissionCustomAnswers } from "@/lib/video/stagePermissionAnswers";
import { replaceGeneralCustomAnswers } from "@/lib/video/customQuestionAnswers";
import { resolveVideoEventSyncTargetIds } from "@/lib/video/syncVideoEvents";
import type { VideoActionResult } from "@/lib/video/types";

export async function submitSlotVideo(
  formData: FormData,
): Promise<VideoActionResult> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "post_video_slotted",
  });
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
  const sessionUser = guard.user;
  const userId = sessionUser.id;
  const approvedXIds = guard.approvedXIds;

  const slotId = String(formData.get("slot_id") ?? "");
  if (!slotId) return { ok: false, message: "枠 ID がありません。" };

  const parsed = parseVideoForm(Object.fromEntries(formData));
  if (!parsed.ok) return parsed;
  const youtubeId = extractYoutubeId(parsed.data.youtube_url);
  if (!youtubeId) return { ok: false, message: "YouTube URL が解析できません。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const requestedX = normalizeXId(sessionUser.active_x_user_id);
  const slotOwnerWhere = requestedX
    ? or(
        eq(slots.x_user_id, requestedX),
        and(eq(slots.discord_user_id, userId), isNull(slots.x_user_id))!,
      )
    : eq(slots.discord_user_id, userId);
  const slotRow = (
    await db
      .select()
      .from(slots)
      .where(and(eq(slots.id, slotId), slotOwnerWhere)!)
      .limit(1)
  )[0];
  if (!slotRow) return { ok: false, message: "枠が見つかりません。" };

  const videoId = slotRow.video_id ?? generateId("v");
  const exists = !!slotRow.video_id;
  const slotX = normalizeXId(slotRow.x_user_id);
  const finalRequestedX = normalizeXId(requestedX || slotRow.x_user_id);
  if (!finalRequestedX) {
    return { ok: false, message: "承認済みの X ID を選択してください。" };
  }
  if (slotX && slotX !== finalRequestedX) {
    return {
      ok: false,
      message: "提出主体の X ID は確保時の ID に固定されます。",
    };
  }
  const activeX = slotX || finalRequestedX;
  if (!approvedXIds.includes(activeX)) {
    return { ok: false, message: "承認済みの X ID を選択してください。" };
  }

  const slotStageFields = await getStagePermissionFieldsForEvents(db, [
    slotRow.event_id,
  ]);
  const stagePermissionResult = buildStagePermissionSubmission(
    formData,
    slotStageFields,
  );
  if (!stagePermissionResult.ok) return stagePermissionResult;
  const stagePermission = stagePermissionResult.value;
  const slotPart = await resolvePartFromSlot(db, slotRow);

  if (await checkYoutubeVideoDuplicate(db, youtubeId, exists ? videoId : undefined)) {
    return { ok: false, message: "この YouTube 動画は既に登録されています。" };
  }

  const memberValidation = validateVideoMemberSubmission(
    formData,
    parsed.data.is_collab ?? false,
  );
  if (!memberValidation.ok) return memberValidation;

  const requestedEventIds = parseEventIdsFromForm(formData);
  const syncedEventIds = await resolveVideoEventSyncTargetIds(db, videoId, {
    requested: requestedEventIds,
    alwaysInclude: [slotRow.event_id],
    user: { id: userId, role: sessionUser.role ?? null },
  });
  const customValidation = await validateCustomAnswersForEvents(
    db,
    formData,
    syncedEventIds,
  );
  if (!customValidation.ok) return customValidation;

  const now = Math.floor(Date.now() / 1000);

  await ensureSubmissionXUser(db, {
    xId: activeX,
    displayName: parsed.data.display_name,
    profileText: parsed.data.profile_text ?? null,
    youtubeChannelUrl: parsed.data.youtube_channel_url ?? null,
    socialLinks: parsed.data.other_social_links ?? null,
    allowProfileUpdate: true,
  });

  try {
    if (exists) {
      await db
        .update(videos)
        .set({
          title: parsed.data.title,
          youtube_video_id: youtubeId,
          creator_x_user_id: activeX || null,
          creator_display_name: parsed.data.display_name,
          creator_icon_url: parsed.data.icon_url || null,
          creator_youtube_channel_url: snapshotYoutubeChannelUrl(
            parsed.data.youtube_channel_url,
          ),
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
        })
        .where(eq(videos.id, videoId));
    } else {
      let displayName =
        parsed.data.display_name || slotRow.display_name || sessionUser.name || "anonymous";
      const iconUrl: string | null = parsed.data.icon_url || null;
      if (activeX) {
        const xRow = (
          await db.select().from(xUsers).where(eq(xUsers.id, activeX)).limit(1)
        )[0];
        if (xRow && !slotRow.display_name) displayName = xRow.x_name || displayName;
      }

      await db.insert(videos).values({
        id: videoId,
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
        visibility_status: "pending",
        primary_event_id: slotRow.event_id,
        scheduling_type: "slotted",
        scheduled_time: slotRow.start_time ?? now,
        music: parsed.data.music ?? null,
        music_reference_url: parsed.data.music_reference_url ?? null,
        credit: parsed.data.credit ?? null,
        intro_comment: parsed.data.intro_comment ?? null,
        highlights: parsed.data.highlights ?? null,
        production_story: parsed.data.production_story ?? null,
        closing_comment: parsed.data.closing_comment ?? null,
        part: slotPart,
        created_at: now,
        updated_at: now,
      });
    }
  } catch (err) {
    if (isYoutubeIdUniqueConstraintError(err)) {
      return { ok: false, message: "この YouTube 動画は既に登録されています。" };
    }
    throw err;
  }

  await ensureVideoDerivedRows(db, { videoId, youtubeVideoId: youtubeId, now });
  await replaceVideoSoftwareLabels(db, videoId, parsed.data.used_software ?? null);
  await syncVideoEvents(db, videoId, {
    requested: requestedEventIds,
    alwaysInclude: [slotRow.event_id],
    user: { id: userId, role: sessionUser.role ?? null },
  });
  await ensurePrimaryEventInVideoEvents(db, videoId, slotRow.event_id);
  await replaceStagePermissionCustomAnswers(db, {
    videoId,
    eventIds: syncedEventIds,
    stagePermission,
    now,
  });
  await replaceGeneralCustomAnswers(db, {
    videoId,
    eventIds: syncedEventIds,
    drafts: customValidation.drafts,
    now,
  });
  await replaceVideoMembers(
    db,
    videoId,
    memberValidation.value.members,
    memberValidation.value.chaptersByIndex,
  );

  await recordXIconCandidateFromVideo(db, {
    xUserId: activeX,
    iconUrl: parsed.data.icon_url ?? null,
    videoId,
  });
  await recordYoutubeChannelCandidateFromVideo(db, {
    xUserId: activeX,
    youtubeChannelUrl: parsed.data.youtube_channel_url ?? null,
    videoId,
  });

  const slotUpdateWhere = slotRow.reservation_group_id
    ? and(
        eq(slots.reservation_group_id, slotRow.reservation_group_id),
        eq(slots.event_id, slotRow.event_id),
        eq(slots.discord_user_id, userId),
        slotRow.x_user_id
          ? eq(slots.x_user_id, slotRow.x_user_id)
          : isNull(slots.x_user_id),
      )!
    : eq(slots.id, slotRow.id);
  await db
    .update(slots)
    .set({ status: "submitted", video_id: videoId, updated_at: now })
    .where(slotUpdateWhere);

  await auditAction(db, {
    table_name: "slots",
    record_id: slotRow.id,
    action: "UPDATE",
    after_data: JSON.stringify({ status: "submitted", video_id: videoId }),
    operator_discord_id: userId,
    retention_class: "normal",
  });

  revalidatePath("/");
  revalidatePath(`/event/${slotRow.event_id}`);
  revalidatePath(`/event/${slotRow.event_id}/slots`);
  revalidatePath("/dashboard");
  const { enqueueAfterVideoCreate } = await import("@/lib/staticRebuild/hooks");
  await enqueueAfterVideoCreate(db, {
    videoId,
    creatorXUserId: activeX || null,
    primaryEventId: slotRow.event_id,
    eventIds: requestedEventIds,
    requestedByUserId: userId,
  });

  if (!exists && shouldEnqueueUserNotification()) {
    const eventRow = (
      await db
        .select({ title: eventsTable.title })
        .from(eventsTable)
        .where(eq(eventsTable.id, slotRow.event_id))
        .limit(1)
    )[0];
    await enqueueNotification(db, {
      discordUserId: userId,
      type: "slot_video_submitted",
      dedupeKey: `slot_video_submitted:${videoId}:${slotRow.id}`,
      payload: buildSlotVideoSubmittedNotification({
        videoId,
        videoTitle: parsed.data.title,
        eventId: slotRow.event_id,
        eventTitle: eventRow?.title ?? "イベント",
      }),
      eventId: slotRow.event_id,
    });
  }

  return {
    ok: true,
    videoId,
    youtubeVideoId: youtubeId,
    eventId: slotRow.event_id,
  };
}
