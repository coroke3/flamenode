import {
  isWriteFeatureKey,
  parseWriteFeatureList,
} from "../../auth/writeGuardCore.ts";

export function validateSpreadsheetDisabledFeaturesJson(value: string): void {
  const parsed = parseWriteFeatureList(value);
  if (!parsed.ok || parsed.features.some((item) => !isWriteFeatureKey(item))) {
    throw new Error("invalid_feature_key");
  }
}
