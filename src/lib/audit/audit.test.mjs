/**
 * 監査ログコアロジックの単体テスト。
 * 実行: node --test --experimental-strip-types src/lib/audit/audit.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
  normalizeAuditCleanupSettings,
  computeAuditCompactCutoff,
  AUDIT_CLEANUP_BATCH_LIMIT,
} from "../../../workers/cleanup/retention.ts";

test("audit mutation は D1 batch と変更件数 assertion を同一取引で使う", async () => {
  const mutateSource = await readFile(
    fileURLToPath(new URL("./mutate.ts", import.meta.url)),
    "utf8",
  );

  // D1 の実環境を必要としない契約テスト。mutation、audit INSERT、
  // post-audit 更新を db.batch の一回の呼び出しに束ね、changes() を
  // assertion していることを固定する。
  assert.match(mutateSource, /await db\.batch\(batchItems/);
  assert.match(mutateSource, /db\.run\(assertChanges\(perStatementExpectedChanges\[index\]/);
  assert.match(mutateSource, /auditChunks\.flatMap/);
  assert.match(mutateSource, /input\.postAuditStatements/);
});

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

test("normalizeAuditCleanupSettings: デフォルトとクランプ", () => {
  assert.equal(
    normalizeAuditCleanupSettings({ audit_compact_after_days: 500 })
      .compactAfterDays,
    365,
  );
  assert.equal(normalizeAuditCleanupSettings(null).compactAfterDays, 30);
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
  const big = "x".repeat(130_000);
  const size = calculatePayloadSize(JSON.stringify({ data: big }), null);
  assert.ok(size > DEFAULT_AUDIT_LOG_SETTINGS.max_payload_bytes);
});
