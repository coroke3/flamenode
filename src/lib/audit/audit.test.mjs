/**
 * 監査ログコアロジックの単体テスト。
 * 実行: node --test --experimental-strip-types src/lib/audit/audit.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeForAudit,
  computeChangedKeys,
  buildInversePatch,
  calculatePayloadSize,
} from "./snapshot.ts";
import {
  clampRetentionDays,
  computeExpiresAt,
  DEFAULT_AUDIT_LOG_SETTINGS,
} from "./retention.ts";
import {
  normalizeAuditLogSettingsRow,
  computeAuditCompactCutoff,
  AUDIT_CLEANUP_BATCH_LIMIT,
} from "../../../workers/cleanup/retention.ts";

test("computeChangedKeys: 差分キーを検出", () => {
  const keys = computeChangedKeys(
    { title: "A", status: "draft" },
    { title: "B", status: "draft" },
  );
  assert.deepEqual(keys, ["title"]);
});

test("sanitizeForAudit: 機密キーをリダクト", () => {
  const out = sanitizeForAudit({
    name: "test",
    access_token: "secret-value",
    password: "pw",
  });
  assert.equal(out?.name, "test");
  assert.equal(out?.access_token, "[REDACTED]");
  assert.equal(out?.password, "[REDACTED]");
});

test("calculatePayloadSize: JSON 文字列サイズ", () => {
  const size = calculatePayloadSize('{"a":1}', '{"b":2}');
  assert.ok(size > 0);
});

test("clampRetentionDays: 範囲内にクランプ", () => {
  assert.equal(clampRetentionDays("normal", 3), 7);
  assert.equal(clampRetentionDays("normal", 500), 365);
  assert.equal(clampRetentionDays("restorable", 10), 14);
  assert.equal(clampRetentionDays("long_audit", 99999), 3650);
});

test("computeExpiresAt: 保持日数から期限を計算", () => {
  const created = 1_700_000_000;
  const expires = computeExpiresAt(created, "normal", DEFAULT_AUDIT_LOG_SETTINGS);
  assert.equal(expires, created + 30 * 86400);
});

test("buildInversePatch: update_before 用パッチ", () => {
  const patch = buildInversePatch(
    { title: "旧", status: "public" },
    { title: "新", status: "public" },
  );
  assert.equal(patch?.title, "旧");
  assert.equal(patch?.status, undefined);
});

test("normalizeAuditLogSettingsRow: デフォルトとクランプ", () => {
  const row = normalizeAuditLogSettingsRow({
    normal_retention_days: 1,
    restorable_retention_days: 2000,
  });
  assert.equal(row.normal_retention_days, 7);
  assert.equal(row.restorable_retention_days, 1095);
  assert.equal(row.long_audit_retention_days, 365);
});

test("computeAuditCompactCutoff", () => {
  const now = 2_000_000_000;
  const cutoff = computeAuditCompactCutoff(now, 30);
  assert.equal(cutoff, now - 30 * 86400);
});

test("AUDIT_CLEANUP_BATCH_LIMIT は 500", () => {
  assert.equal(AUDIT_CLEANUP_BATCH_LIMIT, 500);
});

test("payload 超過判定の閾値", () => {
  const big = "x".repeat(25000);
  const size = calculatePayloadSize(JSON.stringify({ data: big }), null);
  assert.ok(size > DEFAULT_AUDIT_LOG_SETTINGS.max_payload_bytes);
});
