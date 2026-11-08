/**
 * MIG-0652 U01 — framework-neutral CURRENT event "questions" update fields.
 *
 * Parsing/sanitization of required video fields and stage questions happens
 * in the existing CURRENT adapter. This core owns only the field projection
 * and the difference between an omitted and explicit empty form answer.
 */
export type QuestionsEventUpdateInput = {
  allow_user_video_edits: number;
  user_video_edit_permission_keys_json?: string | null;
  editable_fields?: string | null;
  review_settings?: string | null;
};

export function buildQuestionsEventUpdateFields(input: {
  data: QuestionsEventUpdateInput;
  requiredVideoFieldsJson: string | undefined;
  previousRequiredVideoFieldsJson: string | null;
  previousEditableFields: string | null;
  previousReviewSettings: string | null;
}) {
  const { data } = input;
  return {
    allow_user_video_edits: data.allow_user_video_edits,
    user_video_edit_permission_keys_json:
      data.user_video_edit_permission_keys_json ?? null,
    required_video_fields_json:
      input.requiredVideoFieldsJson === undefined
        ? input.previousRequiredVideoFieldsJson
        : input.requiredVideoFieldsJson,
    editable_fields: data.editable_fields ?? input.previousEditableFields,
    review_settings: data.review_settings ?? input.previousReviewSettings,
  };
}
