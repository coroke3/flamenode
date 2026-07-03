export type LegacyImportConflictStrategy = "skip" | "update" | "merge";
export type LegacyImportPreviewStatus = "create" | "update" | "skip" | "merge";

export function resolveLegacyImportPreviewStatus(
  exists: boolean,
  strategy: LegacyImportConflictStrategy,
): LegacyImportPreviewStatus {
  if (!exists) return "create";
  if (strategy === "skip") return "skip";
  return strategy;
}
