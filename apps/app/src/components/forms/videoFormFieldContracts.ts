// MIG-0714 B03: CURRENT field values and presentation contracts; no authority decisions.
import type { VideoMemberInput } from "../../lib/memberInput.ts";
import { questionTypeNeedsOptions } from "../../lib/customQuestions.ts";
// Existing entry DTO has the complete CURRENT CustomQuestion shape without DB imports.
import type { EntryCustomQuestion as CustomQuestion } from "@flamenode/contracts";
import type { OptionalRequiredVideoField } from "../../lib/requiredVideoFields.ts";
import type { VideoEditPermissionViewModel } from "../../lib/permissionUnlockHint.ts";
import type { VideoFormMode } from "./videoSubmitAdapter.ts";

export interface VideoDefaultProfile {
  display_name?: string;
  icon_url?: string | null;
  profile_text?: string | null;
  youtube_channel_url?: string | null;
  other_social_links?: string | null;
}

export interface VideoFormInitialValues {
  updated_at?: number | null;
  display_name?: string;
  creator_x_user_id?: string;
  icon_url?: string;
  profile_text?: string;
  youtube_channel_url?: string;
  other_social_links?: string;
  title?: string;
  youtube_url?: string;
  music?: string;
  music_reference_url?: string;
  credit?: string;
  intro_comment?: string;
  used_software?: string;
  custom_question_answers_json?: string;
  /** 一般イベント質問の既存回答。キーは `${eventId}:${questionKey}`。 */
  custom_answers?: Record<string, string | string[]>;
  highlights?: string;
  production_story?: string;
  closing_comment?: string;
  is_collab?: boolean;
  members?: VideoMemberInput[];
  /** この作品が所属するイベント ID 一覧 (video_events 経由)。 */
  event_ids?: string[];
  /** 作品が選択した「部」(events.parts_json の候補から)。未設定なら null/空文字。 */
  part?: string | null;
}

export interface EventOption {
  id: string;
  title: string;
  video_form_settings_json?: string | null;
  youtube_description_template?: string | null;
  youtube_description_event_url?: string | null;
  /** イベントに設定された「部」候補 (JSON 文字列)。null/空配列なら部 UI を出さない。 */
  parts_json?: string | null;
  /** イベントに設定された一般カスタム質問。 */
  custom_questions?: CustomQuestion[];
  /** イベントが指定する任意必須 VideoForm 項目 (JSON 配列文字列)。 */
  required_video_fields_json?: string | null;
}

export type WizardStepKey = "submitter" | "work" | "youtube" | "confirm";

export type WizardValidationError = {
  message: string;
  fieldId?: string;
  step: WizardStepKey;
};

/** The parent supplies CURRENT-derived display permissions; server authorization is independent. */
export interface VideoFormSectionContext {
  mode: VideoFormMode;
  showPermissionUi: boolean;
  permissionView?: VideoEditPermissionViewModel;
}

/** Native field presentation shared by the submitter, basics and description sections. */
export interface VideoFormInputContext extends VideoFormSectionContext {
  fieldDisabled: (field: string) => boolean;
  isOptionalFieldRequired: (field: OptionalRequiredVideoField) => boolean;
  stepError: WizardValidationError | null;
  setDirty: (dirty: boolean) => void;
}

export function videoFormLockNoteId(key: string): string {
  return `video-form-lock-${key}`;
}

export function mergeDescribedBy(...ids: (string | undefined)[]): string | undefined {
  const filtered = ids.filter(Boolean);
  return filtered.length > 0 ? filtered.join(" ") : undefined;
}

export function customAnswerKey(eventId: string, questionKey: string): string {
  return `${eventId}:${questionKey}`;
}

export function customQuestionFieldId(eventId: string, questionKey: string): string {
  return `custom_answer_${eventId}_${questionKey}`;
}

function customAnswerValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  return value?.trim() ? [value.trim()] : [];
}

export function acceptedCustomAnswerValues(
  question: CustomQuestion,
  value: string | string[] | undefined,
): string[] {
  const values = customAnswerValues(value);
  if (!questionTypeNeedsOptions(question.type)) return values;
  return values.filter((item) => question.options.includes(item));
}
