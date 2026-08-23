/** 通知・インポートpreview・監査ログの期限切れデータを削除する。 */
import {
  computeAuditCompactCutoff,
  computeNotificationCutoffs,
  normalizeAuditCleanupSettings,
  shouldRetryCleanupError,
  AUDIT_CLEANUP_BATCH_LIMIT,
  AUDIT_COMPACT_AFTER_DAYS_DEFAULT,
  CLEANUP_MAX_RETRIES,
  type AuditCleanupSettings,
} from "./retention.ts";
import { logWorkerJob, safeErrorSummary } from "../shared/safeLog.ts";

export interface Env {
  DB: D1Database;
}

type CleanupMetrics = { d1Changes: number };

/** settings SELECT + 6 bounded UPDATE/DELETE statements. */
export const CLEANUP_D1_STATEMENTS_PER_ATTEMPT = 7;
/** 同一invocation内でretryを全て使い切った場合の最大D1 statement数。 */
export const CLEANUP_D1_MAX_STATEMENTS =
  CLEANUP_D1_STATEMENTS_PER_ATTEMPT * CLEANUP_MAX_RETRIES;

function recordD1Changes(
  result: D1Result<unknown>,
  metrics?: CleanupMetrics,
): number {
  const changes = Math.max(0, Number(result.meta?.changes ?? 0));
  if (metrics) metrics.d1Changes += changes;
  return changes;
}

export async function runCleanupWithRetry(
  env: Env,
  signal?: AbortSignal,
): Promise<{
  processed: number;
  failed: number;
  d1_changes: number;
  retry_count: number;
  external_api_calls: 0;
  quota_stopped: false;
}> {
  const startedMs = Date.now();
  const runId = crypto.randomUUID();
  let attempt = 0;
  let retryCount = 0;
  let lastError: unknown = null;
  const metrics: CleanupMetrics = { d1Changes: 0 };
  while (attempt < CLEANUP_MAX_RETRIES) {
    try {
      throwIfAborted(signal, "cleanup aborted");
      await runCleanup(env, signal, metrics);
      return {
        processed: 1,
        failed: 0,
        d1_changes: metrics.d1Changes,
        retry_count: retryCount,
        external_api_calls: 0,
        quota_stopped: false,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      attempt += 1;
      lastError = error;
      const decision = shouldRetryCleanupError(attempt, error);
      logWorkerJob({
        worker: "content-jobs",
        job: "cleanup-retry",
        run_id: runId,
        started_at: new Date(startedMs).toISOString(),
        processed: 0,
        skipped: 0,
        failed: 1,
        duration_ms: Date.now() - startedMs,
        result: "failed",
        error: `${decision.reason}:${safeErrorSummary(error)}`,
      });
      if (!decision.shouldRetry) break;
      retryCount += 1;
      await abortableDelay(100 * attempt, signal);
    }
  }
  logWorkerJob({
    worker: "content-jobs",
    job: "cleanup-give-up",
    run_id: runId,
    started_at: new Date(startedMs).toISOString(),
    processed: 0,
    skipped: 0,
    failed: 1,
    duration_ms: Date.now() - startedMs,
    result: "failed",
    error: safeErrorSummary(lastError),
  });
  return {
    processed: 0,
    failed: 1,
    d1_changes: metrics.d1Changes,
    retry_count: retryCount,
    external_api_calls: 0,
    quota_stopped: false,
  };
}

function throwIfAborted(signal: AbortSignal | undefined, fallback: string): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(signal.reason === undefined ? fallback : String(signal.reason));
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function readAuditCleanupSettings(
  env: Env,
  signal?: AbortSignal,
): Promise<AuditCleanupSettings> {
  try {
    throwIfAborted(signal, "cleanup aborted");
    const row = await env.DB.prepare(
      `SELECT audit_compact_after_days
       FROM system_settings
       WHERE id = 'default'
       LIMIT 1`,
    ).first<{ audit_compact_after_days: number | null }>();
    return normalizeAuditCleanupSettings(row);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn(
      JSON.stringify({
        worker: "content-jobs",
        job: "cleanup-audit-settings",
        result: "fallback",
        error: safeErrorSummary(error),
      }),
    );
    return { compactAfterDays: AUDIT_COMPACT_AFTER_DAYS_DEFAULT };
  }
}

export async function runCleanup(
  env: Env,
  signal?: AbortSignal,
  metrics?: CleanupMetrics,
): Promise<number> {
  throwIfAborted(signal, "cleanup aborted");
  const now = Math.floor(Date.now() / 1000);
  const { sentCutoff, failedCutoff } = computeNotificationCutoffs(now);
  const { compactAfterDays } = await readAuditCleanupSettings(env, signal);
  const compactCutoff = computeAuditCompactCutoff(now, compactAfterDays);
  let d1Changes = 0;

  throwIfAborted(signal, "cleanup aborted");
  const sentResult = await env.DB.prepare(
    `DELETE FROM notification_outbox
     WHERE status = 'sent' AND created_at IS NOT NULL AND created_at < ?1
     LIMIT ?2`,
  )
    .bind(sentCutoff, AUDIT_CLEANUP_BATCH_LIMIT)
    .run();
  d1Changes += recordD1Changes(sentResult, metrics);

  throwIfAborted(signal, "cleanup aborted");
  const failedResult = await env.DB.prepare(
    `DELETE FROM notification_outbox
     WHERE status IN ('failed', 'dead_letter')
       AND created_at IS NOT NULL
       AND created_at < ?1
     LIMIT ?2`,
  )
    .bind(failedCutoff, AUDIT_CLEANUP_BATCH_LIMIT)
    .run();
  d1Changes += recordD1Changes(failedResult, metrics);

  throwIfAborted(signal, "cleanup aborted");
  const importsResult = await env.DB.prepare(
    `DELETE FROM spreadsheet_import_runs
     WHERE nonce IN (
       SELECT nonce
       FROM spreadsheet_import_runs
       WHERE consumed_at IS NOT NULL OR expires_at < ?1
       ORDER BY COALESCE(consumed_at, expires_at) ASC
       LIMIT ?2
     )`,
  )
    .bind(now, AUDIT_CLEANUP_BATCH_LIMIT)
    .run();
  d1Changes += recordD1Changes(importsResult, metrics);

  throwIfAborted(signal, "cleanup aborted");
  const restoreResult = await env.DB.prepare(
    `UPDATE audit_logs
     SET restore_status = 'expired'
     WHERE restore_status = 'restorable'
       AND expires_at IS NOT NULL
       AND expires_at < ?1
     LIMIT ?2`,
  )
    .bind(now, AUDIT_CLEANUP_BATCH_LIMIT)
    .run();
  d1Changes += recordD1Changes(restoreResult, metrics);

  throwIfAborted(signal, "cleanup aborted");
  const auditDeleteResult = await env.DB.prepare(
    `DELETE FROM audit_logs
     WHERE expires_at IS NOT NULL AND expires_at < ?1
     LIMIT ?2`,
  )
    .bind(now, AUDIT_CLEANUP_BATCH_LIMIT)
    .run();
  d1Changes += recordD1Changes(auditDeleteResult, metrics);

  throwIfAborted(signal, "cleanup aborted");
  const compactResult = await env.DB.prepare(
    `UPDATE audit_logs
     SET before_json = NULL,
         after_json = NULL,
         inverse_patch_json = NULL,
         restore_status = CASE
           WHEN restore_status = 'restorable' THEN 'not_restorable'
           ELSE restore_status
         END
     WHERE created_at < ?1
       AND (before_json IS NOT NULL OR after_json IS NOT NULL)
     LIMIT ?2`,
  )
    .bind(compactCutoff, AUDIT_CLEANUP_BATCH_LIMIT)
    .run();
  d1Changes += recordD1Changes(compactResult, metrics);
  return d1Changes;
}
