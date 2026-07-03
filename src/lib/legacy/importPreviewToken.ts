import type { ConflictStrategy } from "./import";
import type { LegacyImportMode, StaticRebuildStrategy } from "./importState";
import { buildStableSha256Token } from "../utils/stableToken.ts";

export type LegacyImportPreviewTokenStrategy = {
  events: ConflictStrategy;
  videos: ConflictStrategy;
  updateXUsers: boolean;
  importMode: LegacyImportMode;
  enqueueStaticRebuild: boolean;
  staticRebuildStrategy: StaticRebuildStrategy;
};

export type LegacyImportPreviewTokenPayload = {
  payload: unknown;
  strategy: LegacyImportPreviewTokenStrategy;
};

export async function buildLegacyImportPreviewToken(
  payload: LegacyImportPreviewTokenPayload,
): Promise<string> {
  return buildStableSha256Token(payload);
}
