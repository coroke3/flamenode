import type { EventStaffPreset } from "../../auth/permissions/presets.ts";
import type { EventVisibilityStatus } from "../../utils/eventStatusCore.ts";

// ============================================================
// ストラテジー / モード
// ============================================================

/** 取り込み戦略 */
export type ImportStrategy = "create_only" | "replace_imported" | "skip_existing";

/** イベントの取り込みモード */
export type ImportMode = "archive" | "preserve" | "active_event" | "draft";

// ============================================================
// カノニカル行型（DB canonical ルール準拠）
// ============================================================

/** events テーブル行 (is_active/is_entry_open/is_archived なし) */
export interface CanonicalEvent {
  id: string;
  title: string;
  event_type: "event" | "collabo" | "type" | "other";
  explanation: string | null;
  icon_url: string | null;
  img_url: string | null;
  start_time: number | null;
  end_time: number | null;
  visibility_status: EventVisibilityStatus;
  representative_x_user_id: string | null;
}

/** event_staff テーブル行 (permission_preset のみ、permission_mask なし) */
export interface CanonicalEventStaff {
  id: string;
  event_id: string;
  x_user_id: string;
  display_name: string;
  /** イベント代表者は必ず owner、その他は必要最小限のプリセットにする。 */
  permission_preset: EventStaffPreset;
  is_public: 0 | 1;
  public_role_label: string | null;
}

/** event_custom_questions テーブル行 */
export interface CanonicalEventCustomQuestion {
  id: string;
  event_id: string;
  question_key: string;
  label: string;
  description: string | null;
  type: "text" | "textarea" | "select" | "radio" | "checkbox";
  required: 0 | 1;
  options_json: string | null;
  placeholder: string | null;
  max_length: number | null;
  sort_order: number;
  is_active: 0 | 1;
  visibility: "review" | "private" | "public";
}

/** videos テーブル行 (stage_permission なし、used_software_json なし) */
export interface CanonicalVideo {
  id: string;
  title: string;
  creator_display_name: string;
  creator_display_name_yomi: string | null;
  creator_x_user_id: string | null;
  creator_icon_url: string | null;
  collaboration_type: "individual" | "collab";
  source_type: "youtube";
  youtube_video_id: string | null;
  music: string | null;
  credit: string | null;
  music_reference_url: string | null;
  intro_comment: string | null;
  closing_comment: string | null;
  highlights: string | null;
  primary_event_id: string | null;
  scheduling_type: "slotted" | "manual";
  scheduled_time: number | null;
  visibility_status: "public";
  created_at: number | null;
}

/** video_events テーブル行 */
export interface CanonicalVideoEvent {
  video_id: string;
  event_id: string;
}

/** video_members テーブル行 (chapters_json あり) */
export interface CanonicalVideoMember {
  id: string;
  video_id: string;
  x_user_id: string | null;
  name: string;
  role: string | null;
  order_index: number;
  chapters_json: string | null;
}

/** video_custom_answers テーブル行 */
export interface CanonicalVideoCustomAnswer {
  video_id: string;
  event_id: string;
  question_id: string;
  question_key: string;
  answer_text: string | null;
}/** software_catalog テーブル行 */
export interface SoftwareCatalogEntry {
  id: string;
  name: string;
  normalized_name: string;
}/** x_users テーブル行 (approval_status = "imported") */
export interface CanonicalXUser {
  id: string;
  x_name: string;
  profile_text: string | null;
  portfolio_contact: string | null;
  youtube_channel_url: string | null;
  other_social_links: string | null;
  approval_status: "imported";
}

/** video_youtube_metadata テーブル行 */
export interface CanonicalYoutubeMetadata {
  video_id: string;
  youtube_video_id: string;
}

// ============================================================
// プラン
// ============================================================

/** 正規化前のビデオの追加データ（プラン構築時に使用） */
export interface VideoNormalizationExtra {
  video_id: string;
  softwareLabels: string[];
  legacyCustomAnswers: Array<{ key: string; value: string }>;
}

/** LegacyImportPlan: applyLegacyImportPlan に渡す完全な計画 */
export interface LegacyImportPlan {
  events: CanonicalEvent[];
  eventStaff: CanonicalEventStaff[];
  eventCustomQuestions: CanonicalEventCustomQuestion[];
  videos: CanonicalVideo[];
  videoEvents: CanonicalVideoEvent[];
  videoMembers: CanonicalVideoMember[];
  videoCustomAnswers: CanonicalVideoCustomAnswer[];
  videoNormExtras: VideoNormalizationExtra[];
  xUsers: CanonicalXUser[];
  youtubeMetadata: CanonicalYoutubeMetadata[];
  warnings: ImportWarning[];
  errors: ImportError[];
  stats: ImportStats;
}

export interface ImportWarning {
  source: string;
  message: string;
}

export interface ImportError {
  source: string;
  message: string;
}

export interface ImportStats {
  events: number;
  videos: number;
  xUsers: number;
  eventStaff: number;
  videoMembers: number;
  softwareLabels: number;
  warnings: number;
  errors: number;
}

// ============================================================
// ドライラン結果
// ============================================================

export interface DryRunPreviewRow {
  kind: "event" | "video";
  id: string;
  title: string;
  /** 取り込み後のアクション予測 */
  action: "create" | "replace" | "skip";
  conflict: boolean;
  visibility_status?: EventVisibilityStatus;
  softwareCount: number;
  memberCount: number;
  warnings: string[];
}

export interface DryRunResult {
  ok: boolean;
  message: string;
  counts: {
    events: { create: number; replace: number; skip: number; failed: number };
    videos: { create: number; replace: number; skip: number; failed: number };
    xUsers: { create: number };
    members: number;
    staff: number;
  };
  preview: DryRunPreviewRow[];
  previewTotal: number;
  errors: string[];
  batchId: string;
}
