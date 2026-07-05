export function isLegacyImportToolEnabled(): boolean {
  return process.env.ENABLE_LEGACY_IMPORT_TOOL === "true";
}
