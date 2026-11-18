import type { CanonicalLegacyPlan, LegacyImportStrategy } from "@flamenode/server-core/legacyImport/normalize";
import { readLegacyImportPreviewFiles, type LegacyImportFileLike, type LegacyImportReadResult } from "./legacyImportFiles.ts";
import { prepareLegacyImportPreview } from "./legacyImportPreview.ts";
import { persistLegacyImportPreview } from "./legacyImportPreviewCommit.ts";

/**
 * MIG-0645: complete, unmounted preview pipeline.
 *
 * The HTTP entrypoint MUST authenticate, authorize, check same origin and
 * CostGuard before reading formData or entering this function. These checks
 * cannot be supplied by the untrusted FormData itself.
 *
 * No D1/R2 implementation is imported here; real bindings will be provided
 * only by a separately reviewed guarded Hono route.
 */
export async function runLegacyImportPreviewPipeline(args: {
  formData: FormData;
  files: readonly LegacyImportFileLike[];
  authUserId: string;
  estimateStoredBytes?: (input: {
    authUserId: string;
    strategy: LegacyImportStrategy;
    plan: CanonicalLegacyPlan;
  }) => number;
  preflight: (plan: CanonicalLegacyPlan, strategy: LegacyImportStrategy) => Promise<{
    existingEventIds: string[];
    existingVideoIds: string[];
  }>;
  createPreview: (input: {
    authUserId: string;
    strategy: LegacyImportStrategy;
    plan: CanonicalLegacyPlan;
    skipExistingEventIds: string[];
    skipExistingVideoIds: string[];
  }) => Promise<{ previewToken: string; planHash: string; expiresAt: number }>;
  mapStoreError: (error: unknown) => { status: 409 | 503; body: Record<string, unknown> };
  now?: number;
}): Promise<{ status: 200 | 400 | 409 | 413 | 422 | 503; body: Record<string, unknown> }> {
  const parsed: LegacyImportReadResult = await readLegacyImportPreviewFiles({
    formData: args.formData,
    files: args.files,
  });
  if (!parsed.ok) return { status: parsed.status, body: parsed.body };

  const prepared = prepareLegacyImportPreview({
    formData: args.formData,
    files: parsed,
    ...(args.now === undefined ? {} : { now: args.now }),
  });
  if (!prepared.ok) return { status: prepared.status, body: prepared.body };

  return persistLegacyImportPreview({
    authUserId: args.authUserId,
    prepared,
    estimateStoredBytes: args.estimateStoredBytes,
    preflight: args.preflight,
    createPreview: args.createPreview,
    mapStoreError: args.mapStoreError,
  });
}
