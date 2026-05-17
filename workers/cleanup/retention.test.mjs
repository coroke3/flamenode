/**
 * cleanup Worker の retention 計算ロジックの単体テスト。
 *
 * 実行:
 *   node --test workers/cleanup/retention.test.mjs
 *
 * 注意: retention.ts は TypeScript なので、tsc 出力を経由するか
 * 直接 node --import で TS を読む必要がある。
 * ここでは Node 22 が標準で持つ Type Stripping (--experimental-strip-types) を活用する。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRetentionDays,
  computeNotificationCutoffs,
  computeHistoryCutoffs,
  computeVoidedVideoHideCutoff,
  HISTORY_NORMAL_DAYS_DEFAULT,
  HISTORY_LONG_AUDIT_DAYS_DEFAULT,
  MIN_HISTORY_DAYS,
  MAX_HISTORY_DAYS,
  SENT_TTL_SEC,
  FAILED_TTL_SEC,
  VOIDED_VIDEO_HIDE_TTL_SEC,
} from "./retention.ts";

test("computeRetentionDays: null/undefined はデフォルト", () => {
  assert.deepEqual(computeRetentionDays(null), {
    normalDays: HISTORY_NORMAL_DAYS_DEFAULT,
    longAuditDays: HISTORY_LONG_AUDIT_DAYS_DEFAULT,
  });
  assert.deepEqual(computeRetentionDays(undefined), {
    normalDays: HISTORY_NORMAL_DAYS_DEFAULT,
    longAuditDays: HISTORY_LONG_AUDIT_DAYS_DEFAULT,
  });
});

test("computeRetentionDays: 異常値はデフォルトにフォールバック", () => {
  assert.deepEqual(computeRetentionDays(-5), {
    normalDays: HISTORY_NORMAL_DAYS_DEFAULT,
    longAuditDays: HISTORY_LONG_AUDIT_DAYS_DEFAULT,
  });
  assert.deepEqual(computeRetentionDays(NaN), {
    normalDays: HISTORY_NORMAL_DAYS_DEFAULT,
    longAuditDays: HISTORY_LONG_AUDIT_DAYS_DEFAULT,
  });
  assert.deepEqual(computeRetentionDays("abc"), {
    normalDays: HISTORY_NORMAL_DAYS_DEFAULT,
    longAuditDays: HISTORY_LONG_AUDIT_DAYS_DEFAULT,
  });
});

test("computeRetentionDays: 範囲内の値を受け入れる", () => {
  const r = computeRetentionDays(30);
  assert.equal(r.normalDays, 30);
  // long_audit はデフォルト 365 を下回らない (30 * 4 = 120 < 365)
  assert.equal(r.longAuditDays, HISTORY_LONG_AUDIT_DAYS_DEFAULT);
});

test("computeRetentionDays: 大きな値は long_audit を normal*4 に追従させる", () => {
  const r = computeRetentionDays(200);
  assert.equal(r.normalDays, 200);
  // 200 * 4 = 800 > 365
  assert.equal(r.longAuditDays, 800);
});

test("computeRetentionDays: 範囲外 (下限/上限) クランプ", () => {
  const lo = computeRetentionDays(1); // MIN は 7
  assert.equal(lo.normalDays, MIN_HISTORY_DAYS);
  const hi = computeRetentionDays(99999); // MAX は 3650
  assert.equal(hi.normalDays, MAX_HISTORY_DAYS);
});

test("computeNotificationCutoffs: now から正しく引き算", () => {
  const now = 2_000_000_000;
  const cutoffs = computeNotificationCutoffs(now);
  assert.equal(cutoffs.sentCutoff, now - SENT_TTL_SEC);
  assert.equal(cutoffs.failedCutoff, now - FAILED_TTL_SEC);
  // failed は sent より長く保持する
  assert.ok(cutoffs.failedCutoff < cutoffs.sentCutoff);
});

test("computeHistoryCutoffs: retention 日数を秒に変換", () => {
  const now = 2_000_000_000;
  const cutoffs = computeHistoryCutoffs(now, { normalDays: 90, longAuditDays: 365 });
  assert.equal(cutoffs.normalCutoff, now - 90 * 86400);
  assert.equal(cutoffs.longAuditCutoff, now - 365 * 86400);
});

test("computeVoidedVideoHideCutoff: 30日前", () => {
  const now = 2_000_000_000;
  assert.equal(computeVoidedVideoHideCutoff(now), now - VOIDED_VIDEO_HIDE_TTL_SEC);
  assert.equal(VOIDED_VIDEO_HIDE_TTL_SEC, 30 * 24 * 60 * 60);
});
