import type { AllowedVideoEditSections } from "@/lib/video/computeEditSections";

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
}

export interface AssertAllowedVideoFieldChangesArgs {
  sections: AllowedVideoEditSections;
  before: VideoFieldChangeSnapshot;
  after: VideoFieldChangeSnapshot;
  submitterChangeRequested?: boolean;
  allowSubmitterChange?: boolean;
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

  if (
    !sections.identity &&
    (changed(after.display_name, before.display_name) ||
      changed(after.icon_url, before.icon_url))
  ) {
    return { ok: false, message: "提出者情報を編集する権限がありません。" };
  }
  if (submitterChangeRequested && !allowSubmitterChange) {
    return {
      ok: false,
      message: "提出主体 X ID の変更には管理者権限が必要です。",
    };
  }
  if (!sections.basics && after.title !== before.title) {
    return { ok: false, message: "作品タイトルを編集する権限がありません。" };
  }
  const youtubeChanged =
    (after.youtube_video_id ?? "") !== (before.youtube_video_id ?? "");
  if (!sections.youtube && youtubeChanged) {
    return { ok: false, message: "YouTube ID を編集する権限がありません。" };
  }
  if (
    !sections.credits &&
    (changed(after.music, before.music) ||
      changed(after.credit, before.credit) ||
      changed(after.music_reference_url, before.music_reference_url))
  ) {
    return { ok: false, message: "楽曲・クレジットを編集する権限がありません。" };
  }
  if (
    !sections.descriptions &&
    (changed(after.intro_comment, before.intro_comment) ||
      changed(after.highlights, before.highlights) ||
      changed(after.production_story, before.production_story) ||
      changed(after.used_software, before.used_software) ||
      changed(after.stage_permission, before.stage_permission) ||
      changed(after.closing_comment, before.closing_comment))
  ) {
    return { ok: false, message: "紹介文・振り返り項目を編集する権限がありません。" };
  }
  // members 権限なしの is_collab 差分は上で説明したとおり無視する。

  return { ok: true };
}
