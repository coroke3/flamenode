"use server";

import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import type { CanEditVideoPrivilegeMode } from "@/lib/auth/ownership";
import { videos, videoEvents, xUsers } from "@/lib/db/schema";
import { getVideoSoftwareLabel } from "@/lib/db/software";
import { snapshotYoutubeChannelUrl } from "@/lib/db/youtubeChannelCandidates";
import { extractYoutubeId } from "@/lib/youtube/id";
import { normalizeXId } from "@/lib/utils/xid";
import { isYoutubeIdUniqueConstraintError } from "@/lib/video/youtubeDuplicate";
import { checkYoutubeVideoDuplicate } from "@/lib/video/slotPart";
import { normalizeSocialLinksForStorage } from "@/lib/socialLinks";
import { parseVideoForm } from "@/lib/video/videoFormSchema";
import {
  resolveVideoCreatorIcon,
  rollbackUploadedVideoIcon,
} from "@/lib/video/resolveVideoCreatorIcon";
import { cleanupReplacedVideoCreatorIcon } from "@/lib/video/videoIconPostCommit";
import { parseEventIdsFromForm } from "@/lib/video/parseEventIds";
import {
  buildStagePermissionSubmission,
  getStagePermissionFieldsForEvents,
} from "@/lib/video/stagePermissionSubmission";
import { readStagePermissionCustomAnswers } from "@/lib/video/stagePermissionAnswers";
import {
  computeAllowedVideoEditSections,
  hasAnyVideoEditSection,
} from "@/lib/video/computeEditSections";
import {
  validateCustomAnswersForEvents,
  validateVideoMemberSubmission,
} from "@/lib/video/submissionValidation";
import type { CustomAnswerDraft } from "@/lib/video/customQuestions";
import {
  MAX_ATOMIC_VIDEO_EVENTS,
  resolveVideoEventSyncTargetIds,
} from "@/lib/video/syncVideoEvents";
import {
  applyVideoUpdatePlan,
  buildVideoUpdatePlan,
  computeStagePermissionDeleteIds,
} from "@/lib/video/videoSavePlan";
import type { VideoActionResult } from "@/lib/video/types";
import { markPendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";

export async function updateVideo(
  formData: FormData,
): Promise<VideoActionResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
  const sessionUser = guard.user;

  const videoId = String(formData.get("video_id") ?? "").trim();
  if (!videoId) return { ok: false, message: "video_id が空です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象作品が見つかりません。" };

  const targetSoftwareLabel = await getVideoSoftwareLabel(db, videoId);
  const stageEventIds = parseEventIdsFromForm(formData);
  if (target.primary_event_id && !stageEventIds.includes(target.primary_event_id)) {
    stageEventIds.push(target.primary_event_id);
  }
  if (stageEventIds.length > MAX_ATOMIC_VIDEO_EVENTS) {
    return { ok: false, message: "選択イベント数が保存上限を超えています。" };
  }
  const editStageFields = await getStagePermissionFieldsForEvents(db, stageEventIds);
  let currentStagePermission: string | null;
  try {
    currentStagePermission = await readStagePermissionCustomAnswers(db, {
      videoId,
      eventIds: stageEventIds,
    });
  } catch (error) {
    console.warn("[updateVideo] stage permission read rejected", error);
    return { ok: false, message: "ステージ許諾回答数が保存上限を超えています。" };
  }

  const raw = Object.fromEntries(formData);
  const setDefault = (key: string, value: string | null | undefined) => {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      raw[key] = value ?? "";
    }
  };
  setDefault(
    "display_name",
    target.creator_display_name ?? target.creator_x_user_id ?? "anonymous",
  );
  setDefault("title", target.title);
  if (!Object.prototype.hasOwnProperty.call(raw, "youtube_url") && target.youtube_video_id) {
    raw.youtube_url = `https://youtu.be/${target.youtube_video_id}`;
  }
  setDefault("creator_x_user_id", target.creator_x_user_id);
  setDefault("icon_mode", "keep");
  setDefault("icon_url", target.creator_icon_url);
  setDefault("profile_text", target.creator_profile_text);
  setDefault("youtube_channel_url", target.creator_youtube_channel_url);
  setDefault("other_social_links", target.creator_other_social_links);
  setDefault("music", target.music);
  setDefault("music_reference_url", target.music_reference_url);
  setDefault("credit", target.credit);
  setDefault("intro_comment", target.intro_comment);
  setDefault("highlights", target.highlights);
  setDefault("production_story", target.production_story);
  setDefault("used_software", targetSoftwareLabel);
  setDefault("closing_comment", target.closing_comment);
  if (!Object.prototype.hasOwnProperty.call(raw, "is_collab")) {
    raw.is_collab = target.collaboration_type === "collab" ? "true" : "false";
  }

  const parsed = parseVideoForm(raw, { youtubeRequired: false });
  if (!parsed.ok) return parsed;

  const rawIconMode = String(formData.get("icon_mode") ?? raw.icon_mode ?? "keep").trim();
  const iconChangeRequested = rawIconMode !== "keep";

  const nextStagePermissionResult = buildStagePermissionSubmission(
    formData,
    editStageFields,
    currentStagePermission,
  );
  if (!nextStagePermissionResult.ok) return nextStagePermissionResult;
  const nextStagePermission = nextStagePermissionResult.value;

  const rawPrivilegeMode = String(formData.get("edit_privilege_mode") ?? "").trim();
  let privilegeMode: CanEditVideoPrivilegeMode = "normal";
  if (rawPrivilegeMode === "admin" && sessionUser.role === "admin") {
    privilegeMode = "admin";
  } else if (rawPrivilegeMode === "event") {
    privilegeMode = "event";
  }

  const editUser = { id: sessionUser.id, role: sessionUser.role ?? null };
  const sections = await computeAllowedVideoEditSections({
    db,
    user: editUser,
    video: target,
    privilegeMode,
  });
  if (!hasAnyVideoEditSection(sections)) {
    return { ok: false, message: "編集権限がありません。" };
  }

  const rawYoutubeUrl = parsed.data.youtube_url.trim();
  let youtubeId: string | null;
  if (rawYoutubeUrl) {
    youtubeId = extractYoutubeId(rawYoutubeUrl);
    if (!youtubeId) return { ok: false, message: "YouTube URL が解析できません。" };
  } else if (sections.youtube) {
    youtubeId = null;
  } else {
    youtubeId = target.youtube_video_id ?? null;
  }

  const existingX = normalizeXId(target.creator_x_user_id);
  const submitterChangeRequested =
    String(formData.get("allow_submitter_change") ?? "").trim() === "1";
  const allowSubmitterChange =
    submitterChangeRequested &&
    sessionUser.role === "admin" &&
    privilegeMode === "admin" &&
    sections.identity;
  const requestedX = normalizeXId(parsed.data.creator_x_user_id);

  let nextCreatorX: string;
  if (allowSubmitterChange) {
    nextCreatorX = requestedX || existingX || "";
  } else {
    nextCreatorX = existingX || "";
  }
  if (!nextCreatorX) {
    return { ok: false, message: "提出主体 X ID が必要です。" };
  }

  const submitterXChanged =
    allowSubmitterChange && nextCreatorX !== existingX;
  let parsedFormData = parsed.data;
  if (submitterXChanged) {
    const profileAction = String(
      formData.get("submitter_profile_action") ?? "",
    ).trim();
    if (profileAction !== "keep" && profileAction !== "copy_default") {
      return {
        ok: false,
        message:
          "提出主体 X ID を変更する場合、提出者情報の扱いを選択してください。",
      };
    }
    if (profileAction === "keep") {
      parsedFormData = {
        ...parsedFormData,
        display_name:
          target.creator_display_name ??
          target.creator_x_user_id ??
          "anonymous",
        icon_url: target.creator_icon_url,
        profile_text: target.creator_profile_text,
        youtube_channel_url: target.creator_youtube_channel_url,
        other_social_links: target.creator_other_social_links,
      };
    } else {
      const nextXProfile = (
        await db
          .select()
          .from(xUsers)
          .where(eq(xUsers.id, nextCreatorX))
          .limit(1)
      )[0];
      if (!nextXProfile) {
        return { ok: false, message: "変更先の X ID が見つかりません。" };
      }
      parsedFormData = {
        ...parsedFormData,
        display_name: nextXProfile.x_name,
        icon_url: nextXProfile.icon_url,
        profile_text: nextXProfile.profile_text,
        youtube_channel_url: nextXProfile.youtube_channel_url,
        other_social_links: nextXProfile.other_social_links,
      };
    }
  }

  const changed = (a: string | null | undefined, b: string | null | undefined) =>
    (a || null) !== (b || null);

  const nextCreatorYoutubeChannelUrl = snapshotYoutubeChannelUrl(
    parsedFormData.youtube_channel_url,
  );
  if (
    !sections.identity &&
    (changed(parsedFormData.display_name, target.creator_display_name) ||
      iconChangeRequested ||
      changed(parsedFormData.profile_text, target.creator_profile_text) ||
      changed(
        normalizeSocialLinksForStorage(parsedFormData.other_social_links),
        target.creator_other_social_links,
      ) ||
      changed(nextCreatorYoutubeChannelUrl, target.creator_youtube_channel_url))
  ) {
    return { ok: false, message: "提出者情報を編集する権限がありません。" };
  }
  if (submitterChangeRequested && !allowSubmitterChange) {
    return {
      ok: false,
      message: "提出主体 X ID の変更には管理者権限が必要です。",
    };
  }
  if (!sections.basics && parsedFormData.title !== target.title) {
    return { ok: false, message: "作品タイトルを編集する権限がありません。" };
  }
  const youtubeChanged = (youtubeId ?? "") !== (target.youtube_video_id ?? "");
  if (!sections.youtube && youtubeChanged) {
    return { ok: false, message: "YouTube ID を編集する権限がありません。" };
  }
  if (
    !sections.credits &&
    (changed(parsedFormData.music, target.music) ||
      changed(parsedFormData.credit, target.credit) ||
      changed(parsedFormData.music_reference_url, target.music_reference_url))
  ) {
    return { ok: false, message: "楽曲・クレジットを編集する権限がありません。" };
  }
  if (
    !sections.descriptions &&
    (changed(parsedFormData.intro_comment, target.intro_comment) ||
      changed(parsedFormData.highlights, target.highlights) ||
      changed(parsedFormData.production_story, target.production_story) ||
      changed(parsedFormData.used_software, targetSoftwareLabel) ||
      changed(nextStagePermission, currentStagePermission) ||
      changed(parsedFormData.closing_comment, target.closing_comment))
  ) {
    return { ok: false, message: "紹介文・振り返り項目を編集する権限がありません。" };
  }
  if (
    !sections.members &&
    parsedFormData.is_collab !== (target.collaboration_type === "collab")
  ) {
    return { ok: false, message: "合作メンバーを編集する権限がありません。" };
  }

  if (sections.youtube && youtubeChanged && youtubeId) {
    if (await checkYoutubeVideoDuplicate(db, youtubeId, videoId)) {
      return { ok: false, message: "この YouTube 動画は既に登録されています。" };
    }
  }

  let memberSubmission = null;
  if (sections.members) {
    const memberValidation = validateVideoMemberSubmission(
      formData,
      parsedFormData.is_collab ?? false,
    );
    if (!memberValidation.ok) return memberValidation;
    memberSubmission = memberValidation.value;
  }

  const hasEventIdsField = formData.has("event_ids");
  let syncedEventIds: string[] | null = null;
  let stagePermissionDeleteEventIds: string[] | undefined;
  let customEventIds = stageEventIds;

  if (sections.primary_event && hasEventIdsField) {
    const requestedEventIds = parseEventIdsFromForm(formData);
    const alwaysInclude = target.primary_event_id ? [target.primary_event_id] : [];
    const previousEventRows = await db
        .select({ event_id: videoEvents.event_id })
        .from(videoEvents)
        .where(eq(videoEvents.video_id, videoId))
        .limit(MAX_ATOMIC_VIDEO_EVENTS + 1);
    if (previousEventRows.length > MAX_ATOMIC_VIDEO_EVENTS) {
      return { ok: false, message: "所属イベント数が原子更新上限を超えています。" };
    }
    const previousEventIds = previousEventRows.map((row) => row.event_id);
    try {
      syncedEventIds = await resolveVideoEventSyncTargetIds(db, videoId, {
        requested: requestedEventIds,
        alwaysInclude,
        user: editUser,
      });
    } catch (error) {
      console.warn("[updateVideo] event plan rejected", error);
      return { ok: false, message: "選択イベント数が保存上限を超えています。" };
    }
    stagePermissionDeleteEventIds = computeStagePermissionDeleteIds({
      previousEventIds,
      syncedEventIds,
    });
    customEventIds = syncedEventIds;
  } else if (sections.descriptions) {
    const customEventRows = await db
        .select({ event_id: videoEvents.event_id })
        .from(videoEvents)
        .where(eq(videoEvents.video_id, videoId))
        .limit(MAX_ATOMIC_VIDEO_EVENTS + 1);
    if (customEventRows.length > MAX_ATOMIC_VIDEO_EVENTS) {
      return { ok: false, message: "所属イベント数が原子更新上限を超えています。" };
    }
    customEventIds = customEventRows.map((row) => row.event_id);
  }

  let customAnswerDrafts: CustomAnswerDraft[] = [];

  if (sections.descriptions) {
    const customValidation = await validateCustomAnswersForEvents(
      db,
      formData,
      customEventIds,
    );
    if (!customValidation.ok) return customValidation;
    customAnswerDrafts = customValidation.drafts;
  }

  let uploadedIconKey: string | null = null;
  if (sections.identity && !submitterXChanged) {
    const iconResolved = await resolveVideoCreatorIcon({
      formData,
      parsed: parsedFormData,
      activeXId: nextCreatorX,
      videoId,
      existingIconUrl: target.creator_icon_url,
      db,
    });
    if (!iconResolved.ok) return iconResolved;
    uploadedIconKey = iconResolved.value.uploadedKey;
    parsedFormData = {
      ...parsedFormData,
      icon_url: iconResolved.value.iconUrl,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const plan = buildVideoUpdatePlan({
    videoId,
    operatorUserId: sessionUser.id,
    privilegeMode,
    allowSubmitterChange,
    sections,
    target,
    targetSoftwareLabel,
    parsed: parsedFormData,
    youtubeId,
    youtubeChanged,
    nextCreatorX,
    nextStagePermission,
    creatorYoutubeChannelUrl: nextCreatorYoutubeChannelUrl,
    memberSubmission,
    customAnswerDrafts,
    syncedEventIds,
    stagePermissionDeleteEventIds,
    hasEventIdsField,
    now,
  });

  let staticRebuildEnqueued: boolean;
  try {
    staticRebuildEnqueued = await applyVideoUpdatePlan(db, plan);
  } catch (err) {
    await rollbackUploadedVideoIcon(uploadedIconKey);
    if (isYoutubeIdUniqueConstraintError(err)) {
      return { ok: false, message: "この YouTube 動画は既に登録されています。" };
    }
    console.warn("[updateVideo] atomic save rejected", err);
    return {
      ok: false,
      message: "保存対象が多すぎるか競合が発生しました。再読み込みして再試行してください。",
    };
  }

  try {
    await cleanupReplacedVideoCreatorIcon(
      db,
      target.creator_icon_url,
      parsedFormData.icon_url,
    );
  } catch (error) {
    console.warn("[updateVideo] icon orphan cleanup failed", error);
  }

  return markPendingPublicReflection(
    {
      ok: true,
      videoId,
      youtubeVideoId: sections.youtube
        ? (youtubeId ?? undefined)
        : (target.youtube_video_id ?? undefined),
      eventId: target.primary_event_id ?? undefined,
    },
    staticRebuildEnqueued,
  );
}
