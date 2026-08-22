import type { AllowedVideoEditSections } from "@/lib/video/computeEditSections";
import type { GeneralEditableFieldKey } from "@/lib/video/generalEditPermissions";

export interface VideoFieldChangeSnapshot {
  display_name?: string | null;
  icon_url?: string | null;
  title?: string | null;
  youtube_video_id?: string | null;
  music?: string | null;
  credit?: string | null;
  music_reference_url?: string | null;
  intro_comment?: string | null;
  highlights?: string | null;
  production_story?: string | null;
  used_software?: string | null;
  stage_permission?: string | null;
  closing_comment?: string | null;
  is_collab?: boolean;
  part?: string | null;
  profile_text?: string | null;
  youtube_channel_url?: string | null;
  other_social_links?: string | null;
}

export interface AssertAllowedVideoFieldChangesArgs {
  sections: AllowedVideoEditSections;
  before: VideoFieldChangeSnapshot;
  after: VideoFieldChangeSnapshot;
  submitterChangeRequested?: boolean;
  allowSubmitterChange?: boolean;
  editableFields?: ReadonlySet<GeneralEditableFieldKey>;
  privilegeMode?: "normal" | "admin" | "event";
  /** Narrow server-derived exception for the first YouTube ID on slotted work. */
  allowInitialYoutubeAttach?: boolean;
}

export type AssertAllowedVideoFieldChangesResult =
  | { ok: true }
  | { ok: false; message: string };

function changed(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a || null) !== (b || null);
}

/**
 * sections が false のフィールド変更を拒否する。1件でも不正なら全体拒否。
 *
 * members 権限がないときの is_collab 差分は拒否しない。
 * disabled な合作チェックボックスが hidden=false を誤送信しても、
 * payload 側は collaboration_type を維持するためデータは壊れない。
 */
export function assertAllowedVideoFieldChanges(
  args: AssertAllowedVideoFieldChangesArgs,
): AssertAllowedVideoFieldChangesResult {
  const { sections, before, after } = args;
  const submitterChangeRequested = args.submitterChangeRequested ?? false;
  const allowSubmitterChange = args.allowSubmitterChange ?? false;
  const fieldAllowed = (key: GeneralEditableFieldKey, sectionAllowed: boolean) =>
    args.privilegeMode === "normal" && args.editableFields
      ? args.editableFields.has(key)
      : sectionAllowed;
  const youtubeFieldAllowed =
    args.allowInitialYoutubeAttach === true ||
    (args.privilegeMode !== "normal" && sections.youtube);

  const submitterFields: Array<[GeneralEditableFieldKey, string | null | undefined, string | null | undefined, string]> = [
    ["display_name", after.display_name, before.display_name, "表示名"],
    ["icon_url", after.icon_url, before.icon_url, "アイコン"],
    ["profile_text", after.profile_text, before.profile_text, "プロフィール文"],
    ["youtube_channel_url", after.youtube_channel_url, before.youtube_channel_url, "YouTubeチャンネル"],
    ["other_social_links", after.other_social_links, before.other_social_links, "SNSリンク"],
  ];
  for (const [key, next, previous, label] of submitterFields) {
    if (!fieldAllowed(key, sections.identity) && changed(next, previous)) {
      return { ok: false, message: `${label}を編集する権限がありません。` };
    }
  }
  if (submitterChangeRequested && !allowSubmitterChange) {
    return {
      ok: false,
      message: "提出主体 X ID の変更には管理者権限が必要です。",
    };
  }
  if (!fieldAllowed("title", sections.basics) && after.title !== before.title) {
    return { ok: false, message: "作品タイトルを編集する権限がありません。" };
  }
  // Imported rows can contain harmless surrounding whitespace.  Compare the
  // canonical ID value so a normal edit of another field is not rejected as
  // an unauthorized YouTube change merely because the legacy spelling differs.
  const normalizedYoutubeId = (value: string | null | undefined) =>
    value?.trim() || null;
  const youtubeChanged =
    normalizedYoutubeId(after.youtube_video_id) !==
    normalizedYoutubeId(before.youtube_video_id);
  if (!youtubeFieldAllowed && youtubeChanged) {
    return { ok: false, message: "YouTube ID を編集する権限がありません。" };
  }
  if (
    (!fieldAllowed("music", sections.credits) && changed(after.music, before.music)) ||
    (!fieldAllowed("credit", sections.credits) && changed(after.credit, before.credit)) ||
    (!fieldAllowed("music_reference_url", sections.credits) &&
      changed(after.music_reference_url, before.music_reference_url))
  ) {
    return { ok: false, message: "楽曲・クレジットを編集する権限がありません。" };
  }
  if (
    (!fieldAllowed("intro_comment", sections.descriptions) && changed(after.intro_comment, before.intro_comment)) ||
    (!fieldAllowed("highlights", sections.descriptions) && changed(after.highlights, before.highlights)) ||
    (!fieldAllowed("production_story", sections.descriptions) && changed(after.production_story, before.production_story)) ||
    (!fieldAllowed("used_software", sections.descriptions) && changed(after.used_software, before.used_software)) ||
    (!fieldAllowed("stage_permission", sections.descriptions) && changed(after.stage_permission, before.stage_permission)) ||
    (!fieldAllowed("closing_comment", sections.descriptions) && changed(after.closing_comment, before.closing_comment))
  ) {
    return { ok: false, message: "紹介文・振り返り項目を編集する権限がありません。" };
  }
  if (!fieldAllowed("part", sections.basics) && changed(after.part, before.part)) {
    return { ok: false, message: "部を編集する権限がありません。" };
  }
  // members 権限なしの is_collab 差分は上で説明したとおり無視する。

  return { ok: true };
}
