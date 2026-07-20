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

export async function runCleanupWithRetry(
  env: Env,
): Promise<{ processed: number; failed: number }> {
  const startedMs = Date.now();
  const runId = crypto.randomUUID();
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt < CLEANUP_MAX_RETRIES) {
    try {
      await runCleanup(env);
      return { processed: 1, failed: 0 };
    } catch (error) {
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
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
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
  return { processed: 0, failed: 1 };
}

export async function readAuditCleanupSettings(
  env: Env,
): Promise<AuditCleanupSettings> {
  try {
    const row = await env.DB.prepare(
      `SELECT audit_compact_after_days
       FROM system_settings
       WHERE id = 'default'
       LIMIT 1`,
    ).first<{ audit_compact_after_days: number | null }>();
    return normalizeAuditCleanupSettings(row);
  } catch (error) {
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

export async function runCleanup(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const { sentCutoff, failedCutoff } = computeNotificationCutoffs(now);
  const { compactAfterDays } = await readAuditCleanupSettings(env);
  const compactCutoff = computeAuditCompactCutoff(now, compactAfterDays);

  await env.DB.prepare(
    `DELETE FROM notification_outbox
     WHERE status = 'sent' AND created_at IS NOT NULL AND created_at < ?1
     LIMIT ?2`,
  )
    .bind(sentCutoff, AUDIT_CLEANUP_BATCH_LIMIT)
    .run();

  await env.DB.prepare(
    `DELETE FROM notification_outbox
     WHERE status IN ('failed', 'dead_letter')
       AND created_at IS NOT NULL
       AND created_at < ?1
     LIMIT ?2`,
  )
    .bind(failedCutoff, AUDIT_CLEANUP_BATCH_LIMIT)
    .run();

  await env.DB.prepare(
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

  await env.DB.prepare(
    `UPDATE audit_logs
     SET restore_status = 'expired'
     WHERE restore_status = 'restorable'
       AND expires_at IS NOT NULL
       AND expires_at < ?1
     LIMIT ?2`,
  )
    .bind(now, AUDIT_CLEANUP_BATCH_LIMIT)
    .run();

  await env.DB.prepare(
    `DELETE FROM audit_logs
     WHERE expires_at IS NOT NULL AND expires_at < ?1
     LIMIT ?2`,
  )
    .bind(now, AUDIT_CLEANUP_BATCH_LIMIT)
    .run();

  await env.DB.prepare(
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
}
