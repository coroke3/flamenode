/**
 * Legacy compatibility bridge. Canonical definitions live in
 * @flamenode/domain/video (packages/domain/src/video/requiredFields.ts);
 * loadUnionRequiredVideoFields stays here because it reads D1.
 */
export {
  ALWAYS_REQUIRED_VIDEO_FIELDS,
  OPTIONAL_REQUIRED_VIDEO_FIELDS,
  type AlwaysRequiredVideoField,
  type OptionalRequiredVideoField,
  type RequiredVideoField,
  type RequiredVideoFieldWizardStep,
  REQUIRED_VIDEO_FIELD_LABELS,
  REQUIRED_VIDEO_FIELD_WIZARD_STEP,
  REQUIRED_VIDEO_FIELD_GROUPS,
  type RequiredVideoFieldValues,
  parseRequiredVideoFields,
  serializeRequiredVideoFields,
  serializeRequiredVideoFieldsFromForm,
  unionRequiredVideoFields,
  isRequiredVideoFieldFilled,
  firstMissingRequiredVideoField,
  missingRequiredVideoFieldMessage,
  formatRequiredVideoFieldSummary,
} from "@flamenode/domain/video";

export { loadUnionRequiredVideoFields } from "@flamenode/server-core/video/requiredVideoFields";
