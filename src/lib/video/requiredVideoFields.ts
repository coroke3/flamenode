/**
 * Legacy compatibility bridge. Canonical definitions live in
 * @flamenode/domain/video (packages/domain/src/video/requiredFields.ts);
 * the D1 loader has now moved to server-core for MIG-0651 while Next keeps this bridge.
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
