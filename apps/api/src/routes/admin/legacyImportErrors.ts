/**
 * MIG-0645 U02c: RH-002 legacy import error response contract.
 * Pure projection only; the Hono POST endpoint is not mounted.
 * CURRENT: app/api/admin/import/legacy/route.ts.
 *
 * Do not report a committed D1 step as rolled back after an R2 CAS failure.
 */
export type LegacyImportErrorBody = {
  ok: false;
  message: string;
  preview_error_code?: string;
  requires_repreview?: boolean;
  retryable?: boolean;
};
export type LegacyImportErrorResponse = {
  status: 409 | 423 | 503;
  body: LegacyImportErrorBody;
};
export type LegacyPreviewErrorCode =
  | "bucket_unavailable" | "invalid_token" | "not_found" | "expired"
  | "owner_mismatch" | "hash_mismatch" | "already_claimed"
  | "claim_conflict" | "invalid_record" | "plan_too_large";

const MUST_REPREVIEW = new Set<LegacyPreviewErrorCode>([
  "not_found", "expired", "owner_mismatch", "hash_mismatch",
  "invalid_record", "invalid_token",
]);

export function legacyImportPreviewFailure(input:
  | { kind: "bindings_unavailable" }
  | { kind: "preview_error"; code: LegacyPreviewErrorCode; message: string }
  | { kind: "other"; transientDb: boolean },
): LegacyImportErrorResponse {
  if (input.kind === "bindings_unavailable") {
    return { status: 503, body: {
      ok: false, message: "runtime_bindings_unavailable",
      retryable: true, requires_repreview: false,
    } };
  }
  if (input.kind === "other") {
    return {
      status: input.transientDb ? 503 : 409,
      body: {
        ok: false,
        message: input.transientDb
          ? "CloudflareまたはR2が一時的に応答できませんでした。"
          : "preview planを確認できませんでした。再度プレビューしてください。",
        retryable: input.transientDb,
        requires_repreview: !input.transientDb,
      },
    };
  }

  const requiresRepreview = MUST_REPREVIEW.has(input.code);
  return {
    status: input.code === "bucket_unavailable" ? 503
      : input.code === "already_claimed" ? 423 : 409,
    body: {
      ok: false,
      message: input.message,
      preview_error_code: input.code,
      requires_repreview: requiresRepreview,
      retryable: !requiresRepreview && (
        input.code === "already_claimed" ||
        input.code === "bucket_unavailable" ||
        input.code === "claim_conflict"
      ),
    },
  };
}

export function legacyImportWriteGuardStatus(reason: string): 401 | 403 | 503 {
  if (reason === "unauthenticated") return 401;
  if (reason === "db_unavailable" || reason === "maintenance_mode" ||
      reason === "cost_guard_blocked") return 503;
  return 403;
}

/**
 * Inputs describe *a D1 step already committed*. Calling code must preserve
 * this distinction when formatting the final result, including R2 failures.
 */
export function legacyImportCommittedProgressPending<
  Summary extends Record<string, unknown>,
  Result extends Record<string, unknown>,
>(args: {
  retryable: boolean;
  planHash: string;
  attempt: number;
  progress: Summary;
  result: Result;
}): { status: 409 | 503; body: Record<string, unknown> } {
  return {
    status: args.retryable ? 503 : 409,
    body: {
      ok: false,
      message: "このステップは保存済み。進捗復旧中",
      committed: true,
      kind: "committed_progress_pending",
      retryable: true,
      requires_repreview: false,
      plan_hash: args.planHash,
      attempt: args.attempt,
      progress: args.progress,
      result: args.result,
    },
  };
}
