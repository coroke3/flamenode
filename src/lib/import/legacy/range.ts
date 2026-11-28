/** MIG-0645 CURRENT compatibility bridge: canonical range logic is shared with Hono. */
export {
  suggestLegacyImportRowRanges,
  legacyImportRangeChunkKey,
  findLegacyImportRangeIndex,
  nextLegacyImportRowRange,
  selectLegacyParsedFileRange,
} from "@flamenode/server-core/legacyImport/range";
export type {
  LegacyImportFileRange,
  RangedLegacyParsedFile,
} from "@flamenode/server-core/legacyImport/range";
