import type { CanonicalLegacyPlan, LegacyImportStrategy } from "@flamenode/server-core/legacyImport/normalize";
import { legacyImportCpuBudgetErrors } from "@flamenode/server-core/legacyImport/cpuBudget";
import { legacyImportApplyCredential } from "./legacyImportApplyInput.ts";
import { commitLegacyImportOneStep, type LegacyImportStepResult } from "./legacyImportAtomicStep.ts";
import { legacyImportCommittedProgressPending } from "./legacyImportErrors.ts";
import { legacyImportApplyProgressSummary, type LegacyImportProgress } from "./legacyImportProgress.ts";

/**
 * MIG-0645 U02 apply transaction orchestrator, not HTTP-mounted.
 *
 * All adapters must be supplied by an authenticated and CostGuard-approved
 * Hono host. This function does no R2 or D1 operations without those adapters.
 * Exactly one D1 step may run per call, and it must be audit-atomic.
 */
export type LegacyImportApplyClaim<Progress extends LegacyImportProgress> = {
  plan: CanonicalLegacyPlan;
  strategy: LegacyImportStrategy;
  planHash: string;
  attempt: number;
  completed: boolean;
  progress: Progress;
  advance: (next: Progress) => Promise<number>;
  complete: () => Promise<number>;
  release: () => Promise<void>;
};

export async function runLegacyImportApplyPipeline<Progress extends LegacyImportProgress>(args: {
  formData: FormData;
  authUserId: string;
  claimPreview: (input: { authUserId: string; previewToken: string; planHash: string }) =>
    Promise<LegacyImportApplyClaim<Progress>>;
  applyStep: (args: {
    plan: CanonicalLegacyPlan;
    strategy: LegacyImportStrategy;
    previewToken: string;
    planHash: string;
    actorAuthUserId: string;
    progress: Progress;
  }) => Promise<LegacyImportStepResult<Progress>>;
  resultFromProgress: (plan: CanonicalLegacyPlan, progress: Progress) => Record<string, unknown>;
  mapPreviewError: (cause: unknown) => { status: 409 | 423 | 503; body: Record<string, unknown> };
  isTransientApplyFailure: (cause: unknown) => boolean;
}): Promise<{ status: 200 | 409 | 423 | 503; body: Record<string, unknown> }> {
  const credential = legacyImportApplyCredential(args.formData);
  if (!credential.ok) return { status: credential.status, body: credential.body };

  let claim: LegacyImportApplyClaim<Progress>;
  try {
    claim = await args.claimPreview({
      authUserId: args.authUserId,
      previewToken: credential.previewToken,
      planHash: credential.planHash,
    });
  } catch (cause) {
    return args.mapPreviewError(cause);
  }

  const progressSummary = (progress: Progress) => legacyImportApplyProgressSummary(claim.plan, progress);
  const result = (progress: Progress, complete: boolean) => ({
    ...args.resultFromProgress(claim.plan, progress), complete,
  });
  const success = (progress: Progress, complete: boolean, expiresAt: number) => ({
    status: 200 as const,
    body: {
      ok: true, mode: "apply", plan_hash: claim.planHash, attempt: claim.attempt,
      continuation_required: !complete, expires_at: expiresAt,
      progress: progressSummary(progress),
      result: result(progress, complete),
    },
  });

  if (claim.completed || claim.progress.stage === "complete") {
    try {
      const expiresAt = await claim.complete();
      return success(claim.progress, true, expiresAt);
    } catch (cause) {
      await claim.release().catch(() => undefined);
      return applyFailure(cause);
    }
  }

  const cpuErrors = legacyImportCpuBudgetErrors(claim.plan);
  if (cpuErrors.length > 0) {
    await claim.release().catch(() => undefined);
    return {
      status: 409,
      body: {
        ok: false,
        message: "Cloudflare Workerの1リクエスト上限を超える入力です。範囲または1作品内の関連データを分割してください。",
        requires_repreview: true, errors: cpuErrors,
      },
    };
  }

  // Do not retry an already committed D1 step after an R2 CAS failure.
  let stepOutcome: Awaited<ReturnType<typeof commitLegacyImportOneStep<Progress>>>;
  try {
    stepOutcome = await commitLegacyImportOneStep({
      applyStep: () => args.applyStep({
        plan: claim.plan,
        strategy: claim.strategy,
        previewToken: credential.previewToken,
        planHash: credential.planHash,
        actorAuthUserId: args.authUserId,
        progress: claim.progress,
      }),
      advanceClaim: claim.advance,
      releaseClaim: claim.release,
    });
  } catch (cause) {
    // commitLegacyImportOneStep already best-effort released on failed D1.
    return applyFailure(cause);
  }
  if (stepOutcome.kind === "advanced") {
    return success(stepOutcome.step.progress, stepOutcome.step.complete, stepOutcome.expiresAt);
  }
  return legacyImportCommittedProgressPending({
    retryable: args.isTransientApplyFailure(stepOutcome.cause),
    planHash: claim.planHash,
    attempt: claim.attempt,
    progress: progressSummary(stepOutcome.step.progress),
    result: result(stepOutcome.step.progress, stepOutcome.step.complete),
  });

  function applyFailure(cause: unknown): { status: 409 | 503; body: Record<string, unknown> } {
    const retryable = args.isTransientApplyFailure(cause);
    const message = retryable
      ? "CloudflareまたはD1/R2が一時的に応答できませんでした。"
      : cause instanceof Error ? cause.message : "インポートを確定できませんでした。";
    return {
      status: retryable ? 503 : 409,
      body: {
        ok: false,
        message: `${message} ${retryable
          ? "preview planは保持されています。同じ内容で再試行できます。"
          : "入力とDB状態を再確認してください。"}`,
        retryable,
        requires_repreview: !retryable,
        plan_hash: claim.planHash,
        attempt: claim.attempt,
        progress: progressSummary(claim.progress),
      },
    };
  }
}
