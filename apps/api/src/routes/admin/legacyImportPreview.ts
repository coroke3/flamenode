import {
  normalizeLegacyFiles,
  type CanonicalLegacyPlan,
  type LegacyImportStrategy,
} from "@flamenode/server-core/legacyImport/normalize";
import { legacyImportCpuBudgetErrors } from "@flamenode/server-core/legacyImport/cpuBudget";
import {
  legacyImportStringField,
  legacyImportVisibility,
  legacyImportStrategy,
  parseLegacyImportVideoFieldDecisions,
} from "./legacyImportInput.ts";
import type {
  LegacyImportFileRange,
  LegacyImportReadResult,
} from "./legacyImportFiles.ts";

/**
 * MIG-0645 U02: CURRENT RH-002 preview normalization and budget boundary.
 * This is pure and unmounted. The protected Hono host must implement same-origin,
 * session, admin permission, CostGuard, D1 preflight and R2 preview storage.
 */
export type LegacyImportPreviewSummary = {
  inputFiles: number;
  sourceRows: number;
  inputRows: number;
  events: number;
  eventStaff: number;
  videos: number;
  videoEvents: number;
  videoMembers: number;
  videoChapters: number;
  xUsers: number;
  softwares: number;
  customQuestions: number;
  customAnswers: number;
  unmappedVideoFields: number;
  warnings: number;
  errors: number;
};

export type LegacyImportPreparedPreview =
  | {
      ok: true;
      mode: "preview";
      plan: CanonicalLegacyPlan;
      strategy: LegacyImportStrategy;
      summary: LegacyImportPreviewSummary;
      fileRanges: LegacyImportFileRange[];
    }
  | {
      ok: false;
      status: 400 | 413 | 422;
      body: Record<string, unknown>;
    };

export function prepareLegacyImportPreview(args: {
  formData: FormData;
  files: LegacyImportReadResult & { ok: true };
  now?: number;
}): LegacyImportPreparedPreview {
  let decisions: ReturnType<typeof parseLegacyImportVideoFieldDecisions>;
  try {
    decisions = parseLegacyImportVideoFieldDecisions(args.formData);
  } catch (cause) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        message: cause instanceof Error
          ? cause.message
          : "動画の未対応項目の指定が不正です。",
      },
    };
  }
  const strategy = legacyImportStrategy(args.formData.get("strategy"));
  const plan = normalizeLegacyFiles(args.files.parsed, {
    eventVisibility: legacyImportVisibility(args.formData.get("event_visibility")),
    videoVisibility: legacyImportVisibility(args.formData.get("video_visibility")),
    videoFieldDecisions: decisions,
    ...(args.now === undefined ? {} : { now: args.now }),
  });
  const cpuErrors = legacyImportCpuBudgetErrors(plan);
  if (cpuErrors.length > 0) {
    return {
      ok: false,
      status: 413,
      body: {
        ok: false,
        mode: "preview",
        message: "Cloudflare Workerの1リクエスト上限を超える入力です。範囲または1作品内の関連データを分割してください。",
        file_ranges: args.files.fileRanges,
        warnings: plan.warnings.slice(0, 100),
        errors: cpuErrors,
        video_custom_field_candidates: plan.unmappedVideoFields,
      },
    };
  }
  const summary: LegacyImportPreviewSummary = {
    inputFiles: args.files.parsed.length,
    sourceRows: args.files.sourceRowCount,
    inputRows: args.files.rowCount,
    events: plan.events.length,
    eventStaff: plan.eventStaff.length,
    videos: plan.videos.length,
    videoEvents: plan.videoEvents.length,
    videoMembers: plan.videoMembers.length,
    videoChapters: plan.videoChapters.length,
    xUsers: plan.xUsers.length,
    softwares: plan.videoSoftwares.length,
    customQuestions: plan.eventCustomQuestions.length,
    customAnswers: plan.videoCustomAnswers.length,
    unmappedVideoFields: plan.unmappedVideoFields.length,
    warnings: plan.warnings.length,
    errors: plan.errors.length,
  };
  if (plan.errors.length > 0) {
    return {
      ok: false,
      status: 422,
      body: {
        ok: false,
        mode: "preview",
        summary,
        file_ranges: args.files.fileRanges,
        warnings: plan.warnings.slice(0, 100),
        errors: plan.errors.slice(0, 100),
        video_custom_field_candidates: plan.unmappedVideoFields,
      },
    };
  }
  return { ok: true, mode: "preview", plan, strategy, summary, fileRanges: args.files.fileRanges };
}
