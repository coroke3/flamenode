/**
 * CURRENT compatibility bridge (MIG-0645): retain the public parser contract.
 * Canonical pure implementation lives in @flamenode/server-core so Hono can
 * parse the same CSV/TSV/JSON without importing Next.js application internals.
 */
export { parseLegacyImportText } from "@flamenode/server-core/legacyImport/parse";
export type { LegacyParsedFile } from "@flamenode/server-core/legacyImport/parse";
