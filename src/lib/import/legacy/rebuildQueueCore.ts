const STEP_TARGET_PATTERN = /^[a-f0-9]{24}:[a-f0-9]{24}:(?:system_user|x_users|softwares|events|custom_questions|videos):\d+$/;

/** 同一preview内の連続ステップでもPKが衝突しない決定的queue IDを返す。 */
export function legacyImportRebuildQueueId(
  stepTargetId: string,
  targetIndex: number,
): string {
  if (!STEP_TARGET_PATTERN.test(stepTargetId)) {
    throw new Error("legacy_import_rebuild_step_target_invalid");
  }
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0) {
    throw new Error("legacy_import_rebuild_target_index_invalid");
  }
  return `legacy_import_${stepTargetId.replaceAll(":", "_")}_${targetIndex}`;
}
