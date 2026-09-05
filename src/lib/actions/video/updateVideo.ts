"use server";

import { eq, inArray } from "drizzle-orm";
import { unstable_rethrow } from "next/navigation";
import { writeGuard } from "@/lib/auth/writeGuard";
import {
  canUseEventPrivilegeModeForVideo,
  resolveVideoEditAccessContext,
  type CanEditVideoPrivilegeMode,
} from "@/lib/auth/ownership";
import { events as eventsTable, videos, videoEvents, xUsers } from "@/lib/db/schema";
import { getVideoSoftwareLabel } from "@/lib/db/software";
import { snapshotYoutubeChannelUrl } from "@/lib/db/youtubeChannelCandidates";
import { extractYoutubeId } from "@/lib/youtube/id";
import { normalizeXId } from "@/lib/utils/xid";
import { isYoutubeIdUniqueConstraintError } from "@/lib/video/youtubeDuplicate";
import { checkYoutubeVideoDuplicate } from "@/lib/video/slotPart";
import { normalizeSocialLinksForStorage } from "@/lib/socialLinks";
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
import { parseEventIdsFromForm, parseEventPartsJson } from "@/lib/video/parseEventIds";
import {
  buildStagePermissionSubmission,
  getStagePermissionFieldsForEvents,
} from "@/lib/video/stagePermissionSubmission";
import { readStagePermissionCustomAnswers } from "@/lib/video/stagePermissionAnswers";
import {
  computeAllowedVideoEditSections,
  hasAnyVideoEditSection,
} from "@/lib/video/computeEditSections";
import type { GeneralEditableFieldKey } from "@/lib/video/generalEditPermissions";
import {
  validateCustomAnswersForEvents,
  validateVideoMemberSubmission,
} from "@/lib/video/submissionValidation";
import {
  loadMemberSubmissionBaseline,
  memberChaptersPayloadChanged,
  memberListPayloadChanged,
  remapMemberChaptersByIdentity,
} from "@/lib/video/memberSubmissionBaseline";
import type { CustomAnswerDraft } from "@/lib/video/customQuestions";
import {
  MAX_ATOMIC_VIDEO_EVENTS,
  resolveVideoEventSyncTargetIds,
} from "@/lib/video/syncVideoEvents";
import { assertAllowedVideoFieldChanges } from "@/lib/video/assertAllowedVideoFieldChanges";
import {
  applyVideoUpdatePlan,
  buildVideoUpdatePlan,
  computeStagePermissionDeleteIds,
} from "@/lib/video/videoSavePlan";
import type { VideoActionResult } from "@/lib/video/types";
import { markPendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import { canAttachInitialYoutubeToSlottedVideo } from "@/lib/video/youtubeAttachEligibility";

const UPDATE_VIDEO_UNEXPECTED_ERROR_MESSAGE =
  "作品の更新中に一時的なエラーが発生しました。入力内容を保持したまま、もう一度お試しください。";

async function updateVideoCore(
  formData: FormData,
): Promise<VideoActionResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
  const sessionUser = guard.user;

  const videoId = String(formData.get("video_id") ?? "").trim();
  if (!videoId) return { ok: false, message: "video_id が空です。" };

  // Reuse the request-local D1 resolved by writeGuard. Re-resolving the
  // Cloudflare binding can fail independently in a Worker request.
  const db = guard.db;
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象作品が見つかりません。" };
  // Historical/imported rows may contain surrounding whitespace.  Treat that
  // as an unset/trimmed ID for parsing and permission comparisons without
  // mutating the stored value unless the caller is already allowed to edit
  // the YouTube field.
  const targetYoutubeVideoId = target.youtube_video_id?.trim() || null;

  // Resolve the request-local authorization snapshot once. Section probes,
  // event privilege selection and later field checks all reuse this result.
  const accessContext = await resolveVideoEditAccessContext({
    db,
    user: { id: sessionUser.id, role: sessionUser.role ?? null },
    video: target,
    approvedXUserIds: guard.approvedXIds,
  });

  const targetSoftwareLabel = await getVideoSoftwareLabel(db, videoId);
  const stageEventIds = parseEventIdsFromForm(formData);
  if (target.primary_event_id && !stageEventIds.includes(target.primary_event_id)) {
    stageEventIds.push(target.primary_event_id);
  }
  if (stageEventIds.length > MAX_ATOMIC_VIDEO_EVENTS) {
    return { ok: false, message: "選択イベント数が保存上限を超えています。" };
  }
  let editStageFields: Awaited<ReturnType<typeof getStagePermissionFieldsForEvents>> = [];
  let currentStagePermission: string | null = null;
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
  // Disabled part controls are omitted from FormData. Preserve the stored
  // value so field-level permission checks do not mistake omission for an
  // attempted change.
  setDefault("part", target.part);
  if (!Object.prototype.hasOwnProperty.call(raw, "youtube_url") && targetYoutubeVideoId) {
    raw.youtube_url = `https://youtu.be/${targetYoutubeVideoId}`;
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

  let nextStagePermission: string | null = currentStagePermission;
  const rawPrivilegeMode = String(formData.get("edit_privilege_mode") ?? "").trim();
  let privilegeMode: CanEditVideoPrivilegeMode = "normal";
  if (rawPrivilegeMode === "admin" && sessionUser.role === "admin") {
    privilegeMode = "admin";
  } else if (rawPrivilegeMode === "event") {
    const canUseEvent = await canUseEventPrivilegeModeForVideo({
      db,
      user: { id: sessionUser.id, role: sessionUser.role ?? null },
      video: target,
      accessContext,
    });
    if (canUseEvent) {
      privilegeMode = "event";
    }
  }

  const editUser = { id: sessionUser.id, role: sessionUser.role ?? null };
  const generalFields: Set<GeneralEditableFieldKey> | undefined =
    privilegeMode === "normal"
      ? new Set(accessContext.ownerEditableFields)
      : undefined;
  const ownership = accessContext.ownership;
  const sections = await computeAllowedVideoEditSections({
    db,
    user: editUser,
    video: target,
    privilegeMode,
    generalFields,
    approvedXUserIds: guard.approvedXIds,
    ownership,
    accessContext,
  });
  if (!hasAnyVideoEditSection(sections)) {
    return {
      ok: false,
      message:
        "編集中に作品の編集権限が変更されました。ページを再読み込みして、現在の権限を確認してください。",
    };
  }

  // Stage answers are an independent canonical field. Do not read or
  // validate required questions when that field is disabled; other edits
  // must retain the existing answers without being blocked by them.
  const canEditStagePermission =
    privilegeMode !== "normal"
      ? sections.descriptions
      : generalFields?.has("stage_permission") === true;
  if (canEditStagePermission) {
    try {
      editStageFields = await getStagePermissionFieldsForEvents(db, stageEventIds);
      currentStagePermission = await readStagePermissionCustomAnswers(db, {
        videoId,
        eventIds: stageEventIds,
      });
    } catch (error) {
      console.warn("[updateVideo] stage permission read rejected", error);
      return { ok: false, message: "\u30b9\u30c6\u30fc\u30b8\u8a31\u8afe\u56de\u7b54\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002" };
    }
    const nextStagePermissionResult = buildStagePermissionSubmission(
      formData,
      editStageFields,
      currentStagePermission,
    );
    if (!nextStagePermissionResult.ok) return nextStagePermissionResult;
    nextStagePermission = nextStagePermissionResult.value;
  }

  let requiredEventIds = stageEventIds;
  if (!formData.has("event_ids")) {
    const linkedRows = await db
      .select({ event_id: videoEvents.event_id })
      .from(videoEvents)
      .where(eq(videoEvents.video_id, videoId))
      .limit(MAX_ATOMIC_VIDEO_EVENTS + 1);
    requiredEventIds = Array.from(
      new Set([
        ...stageEventIds,
        ...linkedRows.map((row) => row.event_id),
      ]),
    );
  }
  const missingRequired = firstMissingRequiredVideoField(
    await loadUnionRequiredVideoFields(db, requiredEventIds),
    {
      ...parsed.data,
      icon_mode: rawIconMode,
      existing_icon_url: target.creator_icon_url,
    },
    privilegeMode === "normal" ? generalFields : undefined,
  );
  if (missingRequired) {
    return { ok: false, message: missingRequiredVideoFieldMessage(missingRequired) };
  }

  const rawYoutubeUrl = parsed.data.youtube_url.trim();
  let youtubeId: string | null;
  if (rawYoutubeUrl) {
    youtubeId = extractYoutubeId(rawYoutubeUrl);
    if (!youtubeId) return { ok: false, message: "YouTube URL が解析できません。" };
  } else if (sections.youtube) {
    youtubeId = null;
  } else {
    youtubeId = targetYoutubeVideoId;
  }

  // computeAllowedVideoEditSections resolves ownership and the effective
  // normal-owner field policy from the request-local authorization snapshot.
  // Keep the first-attachment predicate as a second server-side fence for
  // events that have not opted into the general youtube_url permission.
  const initialYoutubeAttachAllowed =
    sections.youtube &&
    canAttachInitialYoutubeToSlottedVideo({
      sourceType: target.source_type,
      schedulingType: target.scheduling_type,
      visibilityStatus: target.visibility_status,
      youtubeVideoId: targetYoutubeVideoId,
      privilegeMode,
      isCreatorOwner: ownership.isCreatorOwner,
    });
  if (
    initialYoutubeAttachAllowed &&
    (youtubeId ?? "") !== (targetYoutubeVideoId ?? "") &&
    !youtubeId
  ) {
    return {
      ok: false,
      message: "初回のYouTube紐付けには有効なYouTube URLが必要です。",
    };
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

  const nextCreatorYoutubeChannelUrl = snapshotYoutubeChannelUrl(
    parsedFormData.youtube_channel_url,
  );

  const fieldChangeResult = assertAllowedVideoFieldChanges({
    sections,
    before: {
      display_name: target.creator_display_name,
      icon_url: target.creator_icon_url,
      profile_text: target.creator_profile_text,
      youtube_channel_url: target.creator_youtube_channel_url,
      other_social_links: target.creator_other_social_links,
      title: target.title,
      youtube_video_id: target.youtube_video_id,
      music: target.music,
      credit: target.credit,
      music_reference_url: target.music_reference_url,
      intro_comment: target.intro_comment,
      highlights: target.highlights,
      production_story: target.production_story,
      used_software: targetSoftwareLabel,
      stage_permission: currentStagePermission,
      closing_comment: target.closing_comment,
      is_collab: target.collaboration_type === "collab",
      part: target.part,
    },
    after: {
      display_name: parsedFormData.display_name,
      icon_url: parsedFormData.icon_url,
      profile_text: parsedFormData.profile_text,
      youtube_channel_url: nextCreatorYoutubeChannelUrl,
      other_social_links: normalizeSocialLinksForStorage(parsedFormData.other_social_links),
      title: parsedFormData.title,
      youtube_video_id: youtubeId,
      music: parsedFormData.music,
      credit: parsedFormData.credit,
      music_reference_url: parsedFormData.music_reference_url,
      intro_comment: parsedFormData.intro_comment,
      highlights: parsedFormData.highlights,
      production_story: parsedFormData.production_story,
      used_software: parsedFormData.used_software,
      stage_permission: nextStagePermission,
      closing_comment: parsedFormData.closing_comment,
      is_collab: parsedFormData.is_collab ?? false,
      part: parsedFormData.part,
    },
      submitterChangeRequested,
      allowSubmitterChange,
      editableFields: generalFields,
      privilegeMode,
      allowInitialYoutubeAttach: initialYoutubeAttachAllowed,
    });
  if (!fieldChangeResult.ok) return fieldChangeResult;

  const changed = (a: string | null | undefined, b: string | null | undefined) =>
    (a || null) !== (b || null);

  if (
    !sections.identity &&
    (iconChangeRequested ||
      changed(parsedFormData.profile_text, target.creator_profile_text) ||
      changed(
        normalizeSocialLinksForStorage(parsedFormData.other_social_links),
        target.creator_other_social_links,
      ) ||
      changed(nextCreatorYoutubeChannelUrl, target.creator_youtube_channel_url))
  ) {
    return { ok: false, message: "提出者情報を編集する権限がありません。" };
  }
  if (
    !sections.members &&
    parsedFormData.is_collab !== (target.collaboration_type === "collab")
  ) {
    return { ok: false, message: "合作メンバーを編集する権限がありません。" };
  }

  let memberSubmission = null;
  let existingMemberBaseline: Awaited<ReturnType<typeof loadMemberSubmissionBaseline>> | null =
    null;
  let submittedMemberBaseline: Awaited<ReturnType<typeof loadMemberSubmissionBaseline>> | null =
    null;
  let memberChapterRemap: Extract<
    ReturnType<typeof remapMemberChaptersByIdentity>,
    { ok: true }
  > | null = null;
  let chapterComparisonBaseline: Awaited<
    ReturnType<typeof loadMemberSubmissionBaseline>
  > | null = null;
  const isCollabSubmission = parsed.data.is_collab ?? false;
  if (formData.has("members_json") || sections.members || sections.member_chapters) {
    const memberValidation = validateVideoMemberSubmission(
      formData,
      isCollabSubmission,
    );
    if (!memberValidation.ok) return memberValidation;
    submittedMemberBaseline = {
      members: memberValidation.value.members,
      chaptersByIndex: memberValidation.value.chaptersByIndex,
    };
    existingMemberBaseline = await loadMemberSubmissionBaseline(db, videoId);

    // A section may be visible because another field in it is allowed (for
    // example is_collab), so enforce the canonical member/chapter fields
    // separately against crafted members_json payloads.
    const canEditMembersField =
      privilegeMode !== "normal"
        ? sections.members
        : generalFields?.has("members") === true;
    const canEditChaptersField =
      privilegeMode !== "normal"
        ? sections.member_chapters
        : generalFields?.has("chapters") === true;

    if (
      !canEditMembersField &&
      memberListPayloadChanged(existingMemberBaseline, submittedMemberBaseline)
    ) {
      return { ok: false, message: "合作メンバーを編集する権限がありません。" };
    }

    chapterComparisonBaseline = submittedMemberBaseline;
    if (canEditMembersField && !canEditChaptersField) {
      const remap = remapMemberChaptersByIdentity(
        existingMemberBaseline,
        submittedMemberBaseline,
      );
      if (!remap.ok) {
        return {
          ok: false,
          message:
            "メンバーの識別情報が重複または不整合のため、チャプターを安全に引き継げません。再読み込みして確認してください。",
        };
      }
      if (remap.unmatchedSubmittedWithChapters) {
        return { ok: false, message: "メンバーチャプターを編集する権限がありません。" };
      }
      memberChapterRemap = remap;
      chapterComparisonBaseline = {
        ...submittedMemberBaseline,
        chaptersByIndex: remap.byBaselineIndex,
      };
    }

    if (
      !canEditChaptersField &&
      memberChaptersPayloadChanged(existingMemberBaseline, chapterComparisonBaseline)
    ) {
      return { ok: false, message: "メンバーチャプターを編集する権限がありません。" };
    }

    if (sections.members && canEditMembersField) {
      memberSubmission = memberValidation.value;
      if (!sections.member_chapters) {
        memberSubmission = {
          ...memberSubmission,
          chaptersByIndex:
            memberChapterRemap?.bySubmittedIndex ??
            existingMemberBaseline.chaptersByIndex,
        };
      }
    } else if (sections.member_chapters && canEditChaptersField) {
      memberSubmission = {
        members: existingMemberBaseline.members,
        chaptersByIndex: submittedMemberBaseline.chaptersByIndex,
      };
    }
  }

  if (privilegeMode === "normal") {
    if (changed(parsedFormData.profile_text, target.creator_profile_text) && !generalFields?.has("profile_text")) {
      return { ok: false, message: "紹介文を編集する権限がありません。" };
    }
    if (
      changed(
        normalizeSocialLinksForStorage(parsedFormData.other_social_links),
        target.creator_other_social_links,
      ) && !generalFields?.has("other_social_links")
    ) {
      return { ok: false, message: "SNSリンクを編集する権限がありません。" };
    }
    const nextCreatorYoutube = snapshotYoutubeChannelUrl(
      parsedFormData.youtube_channel_url,
    );
    if (
      changed(nextCreatorYoutube, target.creator_youtube_channel_url) &&
      !generalFields?.has("youtube_channel_url")
    ) {
      return { ok: false, message: "提出者YouTubeチャンネルを編集する権限がありません。" };
    }
    if (
      changed(parsed.data.display_name, target.creator_display_name) &&
      !generalFields?.has("display_name")
    ) {
      return { ok: false, message: "表示名を編集する権限がありません。" };
    }
    if (
      iconChangeRequested &&
      !generalFields?.has("icon_url")
    ) {
      return { ok: false, message: "アイコンを編集する権限がありません。" };
    }
    if (parsed.data.title !== target.title && !generalFields?.has("title")) {
      return { ok: false, message: "作品タイトルを編集する権限がありません。" };
    }
    if (changed(parsed.data.music, target.music) && !generalFields?.has("music")) {
      return { ok: false, message: "楽曲名を編集する権限がありません。" };
    }
    if (
      changed(parsed.data.music_reference_url, target.music_reference_url) &&
      !generalFields?.has("music_reference_url")
    ) {
      return { ok: false, message: "楽曲参照URLを編集する権限がありません。" };
    }
    if (changed(parsed.data.credit, target.credit) && !generalFields?.has("credit")) {
      return { ok: false, message: "クレジットを編集する権限がありません。" };
    }
    if (
      changed(parsed.data.intro_comment, target.intro_comment) &&
      !generalFields?.has("intro_comment")
    ) {
      return { ok: false, message: "紹介コメントを編集する権限がありません。" };
    }
    if (
      changed(parsed.data.highlights, target.highlights) &&
      !generalFields?.has("highlights")
    ) {
      return { ok: false, message: "見どころを編集する権限がありません。" };
    }
    if (
      changed(parsed.data.production_story, target.production_story) &&
      !generalFields?.has("production_story")
    ) {
      return { ok: false, message: "制作エピソードを編集する権限がありません。" };
    }
    if (
      changed(parsed.data.used_software, targetSoftwareLabel) &&
      !generalFields?.has("used_software")
    ) {
      return { ok: false, message: "使用ソフトを編集する権限がありません。" };
    }
    if (
      changed(parsed.data.closing_comment, target.closing_comment) &&
      !generalFields?.has("closing_comment")
    ) {
      return { ok: false, message: "締めコメントを編集する権限がありません。" };
    }
    if (
      parsed.data.is_collab !== (target.collaboration_type === "collab") &&
      !generalFields?.has("is_collab")
    ) {
      return { ok: false, message: "合作メンバーを編集する権限がありません。" };
    }
    if (
      sections.members &&
      submittedMemberBaseline &&
      existingMemberBaseline &&
      memberChaptersPayloadChanged(
        existingMemberBaseline,
        chapterComparisonBaseline ?? submittedMemberBaseline,
      ) &&
      !generalFields?.has("chapters")
    ) {
      return { ok: false, message: "メンバーチャプターを編集する権限がありません。" };
    }
    if (changed(nextStagePermission, currentStagePermission) && !generalFields?.has("stage_permission")) {
      return { ok: false, message: "ステージ利用許可を編集する権限がありません。" };
    }
  }

  // 枠投稿の part は枠由来のスナップショットを正本にし、手入力を無視する。
  // 枠なし作品でも、設定済みイベントの候補外文字列は受け付けない。
  if (target.scheduling_type !== "slotted" && changed(parsedFormData.part, target.part)) {
    const linkedRows = await db
      .select({ event_id: videoEvents.event_id })
      .from(videoEvents)
      .where(eq(videoEvents.video_id, videoId))
      .limit(MAX_ATOMIC_VIDEO_EVENTS + 1);
    const eventIds = Array.from(new Set([
      ...(target.primary_event_id ? [target.primary_event_id] : []),
      ...linkedRows.map((row) => row.event_id),
    ])).slice(0, MAX_ATOMIC_VIDEO_EVENTS);
    if (eventIds.length > 0) {
      const eventRows = await db
        .select({ parts_json: eventsTable.parts_json })
        .from(eventsTable)
        .where(inArray(eventsTable.id, eventIds));
      const configuredParts = new Set(
        eventRows.flatMap((row) => parseEventPartsJson(row.parts_json)),
      );
      const nextPart = parsedFormData.part?.trim() || null;
      if (nextPart && (configuredParts.size === 0 || !configuredParts.has(nextPart))) {
        return { ok: false, message: "選択した部が所属イベントの候補にありません。" };
      }
    }
  }

  // Only an enabled YouTube field can change the stored value.  Compare with
  // the raw persisted value here (rather than the trimmed display value) so
  // privileged cleanup of a legacy whitespace-only ID still clears metadata
  // and rebuilds the affected public artifacts.  When the field is disabled,
  // omitted input must remain a no-op even for legacy rows.
  const youtubeChanged =
    sections.youtube &&
    (youtubeId ?? null) !== (target.youtube_video_id ?? null);
  if (sections.youtube && youtubeChanged && youtubeId) {
    if (await checkYoutubeVideoDuplicate(db, youtubeId, videoId)) {
      return { ok: false, message: "この YouTube 動画は既に登録されています。" };
    }
  }

  const hasEventIdsField = formData.has("event_ids");
  let syncedEventIds: string[] | null = null;
  let stagePermissionDeleteEventIds: string[] | undefined;
  let customEventIds = stageEventIds;
  const canEditCustomAnswers =
    privilegeMode !== "normal"
      ? sections.descriptions
      : generalFields?.has("custom_answers") === true;

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
  } else if (canEditCustomAnswers || sections.descriptions) {
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

  if (canEditCustomAnswers) {
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
    ownerEditableFields: generalFields,
    allowInitialYoutubeAttach: initialYoutubeAttachAllowed,
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
        : (targetYoutubeVideoId ?? undefined),
      eventId: target.primary_event_id ?? undefined,
    },
    staticRebuildEnqueued,
  );
}

/** Keep transient D1/R2/preflight failures in the Server Action result shape. */
export async function updateVideo(
  formData: FormData,
): Promise<VideoActionResult> {
  try {
    return await updateVideoCore(formData);
  } catch (error) {
    unstable_rethrow(error);
    console.warn("[updateVideo] preflight rejected", error);
    return {
      ok: false,
      message: UPDATE_VIDEO_UNEXPECTED_ERROR_MESSAGE,
    };
  }
}
