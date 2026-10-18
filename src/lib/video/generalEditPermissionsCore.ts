/**
 * Legacy compatibility bridge for generalEditPermissionsCore.
 * Canonical definitions live in @flamenode/domain/video
 * (packages/domain/src/video/generalEditPermissions.ts). Export surface is kept
 * identical to the pre-extraction file.
 */
export {
  GENERAL_EDITABLE_FIELD_KEYS,
  type GeneralEditableFieldKey,
  type VideoParameterRisk,
  VIDEO_SYSTEM_ONLY_PARAMETER_KEYS,
  GENERAL_EDITABLE_FIELD_LABELS,
  GENERAL_EDITABLE_FIELD_HELP,
  GENERAL_EDITABLE_FIELD_GROUPS,
  type OwnerEditableFieldDefinition,
  OWNER_EDITABLE_FIELD_DEFINITIONS,
  normalizeGeneralEditableFields,
  serializeGeneralEditableFields,
  parseGeneralEditableFields,
  type GeneralEditablePolicyV2,
  parseGeneralEditablePolicyV2,
  resolveGeneralEditableFieldsFromPolicy,
  resolveGeneralEditableScope,
  sectionAllowedByGeneralFields,
  disabledFieldKeysFromGeneralFields,
} from "@flamenode/domain/video";
