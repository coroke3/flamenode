import { MAX_GENERAL_CUSTOM_QUESTIONS } from "./limits.ts";

/**
 * Preserve existing event question capacity when an older event/template
 * already exceeds the current creation cap. New creation still uses the
 * canonical limit exported by the domain package.
 */
export function resolveGeneralCustomQuestionCap(args: {
  existingCount: number;
  templateCount: number;
}): number {
  return Math.max(
    MAX_GENERAL_CUSTOM_QUESTIONS,
    args.existingCount,
    args.templateCount,
  );
}
