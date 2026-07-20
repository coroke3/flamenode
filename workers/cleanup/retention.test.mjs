import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAuditCompactCutoff,
  computeNotificationCutoffs,
  normalizeAuditCleanupSettings,
  shouldRetryCleanupError,
  AUDIT_COMPACT_AFTER_DAYS_DEFAULT,
  CLEANUP_MAX_RETRIES,
  SENT_TTL_SEC,
  FAILED_TTL_SEC,
} from "./retention.ts";

test("通知保持期限を現在時刻から計算する", () => {
  const now = 2_000_000_000;
  const cutoffs = computeNotificationCutoffs(now);
  assert.equal(cutoffs.sentCutoff, now - SENT_TTL_SEC);
  assert.equal(cutoffs.failedCutoff, now - FAILED_TTL_SEC);
});

test("system_settings.audit_compact_after_daysを正規化する", () => {
  assert.deepEqual(normalizeAuditCleanupSettings(null), {
    compactAfterDays: AUDIT_COMPACT_AFTER_DAYS_DEFAULT,
  });
  assert.equal(
    normalizeAuditCleanupSettings({ audit_compact_after_days: 14 })
      .compactAfterDays,
    14,
  );
  assert.equal(
    normalizeAuditCleanupSettings({ audit_compact_after_days: -1 })
      .compactAfterDays,
    AUDIT_COMPACT_AFTER_DAYS_DEFAULT,
  );
});

test("監査payload軽量化cutoffを計算する", () => {
  const now = 2_000_000_000;
  assert.equal(computeAuditCompactCutoff(now, 14), now - 14 * 86400);
});

test("cleanupリトライ判定はschema errorを再試行しない", () => {
  assert.equal(
    shouldRetryCleanupError(0, new Error("no such column: old_column"))
      .shouldRetry,
    false,
  );
  assert.equal(
    shouldRetryCleanupError(CLEANUP_MAX_RETRIES, new Error("timeout"))
      .shouldRetry,
    false,
  );
  assert.equal(
    shouldRetryCleanupError(0, new Error("HTTP 503")).shouldRetry,
    true,
  );
});
