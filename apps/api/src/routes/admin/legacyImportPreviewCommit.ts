import type { CanonicalLegacyPlan, LegacyImportStrategy } from "@flamenode/server-core/legacyImport/normalize";
import type { LegacyImportPreparedPreview, LegacyImportPreviewSummary } from "./legacyImportPreview.ts";
import type { LegacyImportFileRange } from "./legacyImportFiles.ts";

/**
 * MIG-0645: unmounted, dependency-injected RH-002 preview persistence boundary.
 * Enforces the CURRENT 512 KiB plan threshold before D1 preflight and R2 put.
 * Caller MUST enforce origin, authentication, admin-write + CostGuard before entry.
 */
export const LEGACY_IMPORT_MAX_STORED_PLAN_BYTES = 512 * 1024;
export const LEGACY_IMPORT_PLAN_WARN_BYTES =
  Math.floor(LEGACY_IMPORT_MAX_STORED_PLAN_BYTES * 0.8);

export type LegacyImportPreviewCredential = {
  previewToken: string;
  planHash: string;
  expiresAt: number;
};

export type LegacyImportPersistedPreview =
  | { status: 200; body: Record<string, unknown> }
  | { status: 409 | 413 | 503; body: Record<string, unknown> };

export async function persistLegacyImportPreview(args: {
  authUserId: string;
  prepared: LegacyImportPreparedPreview & { ok: true };
  estimateStoredBytes: (input: {
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
  }) => Promise<LegacyImportPreviewCredential>;
  mapStoreError: (error: unknown) => { status: 409 | 503; body: Record<string, unknown> };
}): Promise<LegacyImportPersistedPreview> {
  const { prepared, authUserId } = args;
  const { plan, summary, strategy, fileRanges } = prepared;
  const storedBytes = args.estimateStoredBytes({ authUserId, strategy, plan });
  if (storedBytes > LEGACY_IMPORT_MAX_STORED_PLAN_BYTES) {
    return {
      status: 413,
      body: {
        ok: false,
        mode: "preview",
        message: "正規化後planがCloudflare用上限512KBを超えました。開始・終了位置を狭めてください。",
        summary,
        file_ranges: fileRanges,
        warnings: plan.warnings.slice(0, 100),
        errors: ["applyは各リクエストでplanを検証するため、巨大planを保存するとWorker CPU上限を超えます。"],
        video_custom_field_candidates: plan.unmappedVideoFields,
      },
    };
  }
  let existing: Awaited<ReturnType<typeof args.preflight>>;
  try {
    existing = await args.preflight(plan, strategy);
  } catch (cause) {
    return {
      status: 409,
      body: {
        ok: false,
        message: cause instanceof Error ? cause.message : "現在のDB状態へ適用できないplanです。",
        mode: "preview",
        summary,
        file_ranges: fileRanges,
        warnings: plan.warnings.slice(0, 100),
        requires_repreview: false,
      },
    };
  }

  let credential: LegacyImportPreviewCredential;
  try {
    credential = await args.createPreview({
      authUserId,
      strategy,
      plan,
      skipExistingEventIds: strategy === "skip_existing" ? existing.existingEventIds : [],
      skipExistingVideoIds: strategy === "skip_existing" ? existing.existingVideoIds : [],
    });
  } catch (cause) {
    const mapped = args.mapStoreError(cause);
    return { status: mapped.status, body: mapped.body };
  }

  const warnings = plan.warnings.slice(0, 100);
  if (storedBytes > LEGACY_IMPORT_PLAN_WARN_BYTES) {
    warnings.unshift(
      `正規化後のplanがCloudflare CPU目安の80%を超えています（約${Math.ceil(storedBytes / 1024).toLocaleString()}KB / 上限512KB）。開始・終了位置をさらに狭めると安定します。`,
    );
  }
  return {
    status: 200,
    body: {
      ok: true,
      mode: "preview",
      summary,
      warnings,
      errors: [],
      preview_token: credential.previewToken,
      plan_hash: credential.planHash,
      expires_at: credential.expiresAt,
      strategy,
      file_ranges: fileRanges,
      video_custom_field_candidates: plan.unmappedVideoFields,
      preview: {
        events: plan.events.slice(0, 20).map(({ id, title, visibility_status }) => ({ id, title, visibility_status })),
        videos: plan.videos.slice(0, 50).map(({ id, title, creator_display_name, visibility_status }) => ({
          id, title, creator_display_name, visibility_status,
        })),
      },
    },
  };
}
