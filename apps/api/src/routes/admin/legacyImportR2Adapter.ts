import {
  createLegacyImportPreview,
  claimLegacyImportPreview,
  LegacyImportPreviewError,
} from "@flamenode/server-core/legacyImport/previewStore";
import { legacyImportPreviewFailure } from "./legacyImportErrors.ts";

/**
 * MIG-0645 U02: actual R2 preview-store adapter for the future Hono route.
 *
 * This adapter carries NO auth policy. Call it only *after* same-origin,
 * authenticated admin write identity and CostGuard have passed.
 * The underlying shared implementation binds the preview to authUserId,
 * validates plan hash, and uses ETag CAS for claim and progress.
 *
 * The route is intentionally not mounted until D1/audit parity is complete.
 */
export function legacyImportR2Adapter(bucket: R2Bucket | null | undefined) {
  return {
    createPreview: (input: Parameters<typeof createLegacyImportPreview>[1]) =>
      createLegacyImportPreview(bucket, input),
    claimPreview: (input: Parameters<typeof claimLegacyImportPreview>[1]) =>
      claimLegacyImportPreview(bucket, input),
    mapPreviewError: (cause: unknown) => {
      if (cause instanceof LegacyImportPreviewError) {
        return legacyImportPreviewFailure({
          kind: "preview_error",
          code: cause.code,
          message: cause.message,
        });
      }
      if (!bucket) return legacyImportPreviewFailure({ kind: "bindings_unavailable" });
      return legacyImportPreviewFailure({ kind: "other", transientDb: false });
    },
  };
}
