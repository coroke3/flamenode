// MIG-0306 U03: admin moderation rules (SA-016..020, 043..048, 051..055).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OVERRIDE_DURATION_SEC,
  checkExpectedDisabledFeatures,
  decideNotificationCancel,
  decideTermsPublish,
  isOperationMode,
  nextTermsPublishedAt,
  notificationCancelPatch,
  notificationRetryPatch,
  parseClearCostGuardOverrideInput,
  parseCostGuardModeInput,
  parseCostGuardOverrideInput,
  parseDisabledFeaturesInput,
  parseMaintenanceModeInput,
  parseModerationDueAt,
  parseTermsDraftInput,
  parseTermsReacceptBroadcastInput,
  resolveMaintenanceTargetMode,
  resolveOperationMode,
} from "@flamenode/domain/admin";

const reason501 = "x".repeat(501);

test("SA-016 mode: maintenance is not selectable here and reason is required", () => {
  assert.deepEqual(parseCostGuardModeInput({ mode: "economy", reason: " r " }), {
    ok: true, mode: "economy", reason: "r",
  });
  assert.equal(parseCostGuardModeInput({ mode: "maintenance", reason: "r" }).ok, false);
  assert.equal(parseCostGuardModeInput({ mode: "normal", reason: "  " }).ok, false);
});

test("SA-017 maintenance: 0/1 only, and turning it off returns to normal", () => {
  assert.deepEqual(parseMaintenanceModeInput({ isMaintenanceMode: null, reason: "r" }), {
    ok: true, enable: false, reason: "r",
  });
  assert.deepEqual(parseMaintenanceModeInput({ isMaintenanceMode: "2", reason: "r" }), {
    ok: false, message: "値が不正です。",
  });
  assert.deepEqual(parseMaintenanceModeInput({ isMaintenanceMode: "1", reason: reason501 }), {
    ok: false, message: "500文字以内の理由が必要です。",
  });
  assert.equal(resolveMaintenanceTargetMode("economy", true), "maintenance");
  assert.equal(resolveMaintenanceTargetMode("maintenance", false), "normal");
  assert.equal(resolveMaintenanceTargetMode("read_only", false), "read_only");
  assert.equal(resolveOperationMode({ operation_mode: "bogus" }), "normal");
  assert.equal(isOperationMode("maintenance"), true);
});

test("SA-018 override: confirm, 1..8 unique allowlisted features, 15 minutes", () => {
  assert.equal(OVERRIDE_DURATION_SEC, 900);
  const ok = parseCostGuardOverrideInput({ reason: "r", confirm: "OVERRIDE", features: ["edit_video"] });
  assert.deepEqual(ok, { ok: true, reason: "r", features: ["edit_video"] });
  assert.equal(parseCostGuardOverrideInput({ reason: "r", confirm: "override", features: ["edit_video"] }).message, "確認文字列OVERRIDEが一致しません。");
  assert.equal(parseCostGuardOverrideInput({ reason: "r", confirm: "OVERRIDE", features: [] }).ok, false);
  assert.equal(parseCostGuardOverrideInput({ reason: "r", confirm: "OVERRIDE", features: ["edit_video", "edit_video"] }).ok, false);
  assert.equal(parseCostGuardOverrideInput({ reason: "r", confirm: "OVERRIDE", features: Array(9).fill(0).map((_, i) => `f${i}`) }).ok, false);
  assert.deepEqual(parseCostGuardOverrideInput({ reason: "r", confirm: "OVERRIDE", features: ["nope"] }), {
    ok: false, message: "未知の機能キーが含まれています。",
  });
});

test("SA-019 disabled features: canonical order, empty set allowed, optimistic check", () => {
  assert.deepEqual(
    parseDisabledFeaturesInput({ reason: "r", confirm: "APPLY", features: [" reserve_slot", "edit_video "] }),
    { ok: true, reason: "r", features: ["edit_video", "reserve_slot"] },
  );
  assert.deepEqual(parseDisabledFeaturesInput({ reason: "r", confirm: "APPLY", features: [] }), {
    ok: true, reason: "r", features: [],
  });
  assert.equal(parseDisabledFeaturesInput({ reason: "r", confirm: "APPLY", features: ["unknown"] }).message, "未許可の機能キーが含まれています。");
  const stale = "設定の取得時点を確認できません。ページを再読み込みしてください。";
  assert.deepEqual(checkExpectedDisabledFeatures(null, null), { ok: false, message: stale });
  assert.deepEqual(checkExpectedDisabledFeatures("{", null), { ok: false, message: stale });
  assert.deepEqual(checkExpectedDisabledFeatures("1", null), { ok: false, message: stale });
  assert.deepEqual(checkExpectedDisabledFeatures("null", null), { ok: true });
  assert.deepEqual(checkExpectedDisabledFeatures(JSON.stringify('["edit_video"]'), '["edit_video"]'), { ok: true });
  assert.equal(checkExpectedDisabledFeatures("null", "[]").message, "設定が別の管理者によって変更されています。ページを再読み込みしてください。");
});

test("SA-020 clear override needs CLEAR", () => {
  assert.deepEqual(parseClearCostGuardOverrideInput({ reason: "r", confirm: "CLEAR" }), { ok: true, reason: "r" });
  assert.deepEqual(parseClearCostGuardOverrideInput({ reason: "", confirm: "CLEAR" }), {
    ok: false, message: "500文字以内の解除理由が必要です。",
  });
});

test("SA-045..048 notification retry/cancel transitions", () => {
  assert.deepEqual(notificationRetryPatch(7), {
    status: "pending", attempt_count: 0, processing_started_at: null, lease_token: null,
    lease_expires_at: null, next_attempt_at: 7, last_error: null, processed_at: null,
  });
  assert.equal(notificationCancelPatch(7).last_error, "manual cancel");
  assert.equal(notificationCancelPatch(7, "dup").last_error, "dup");
  assert.deepEqual(decideNotificationCancel("sent"), { kind: "already_terminal", message: "既にsentです。" });
  assert.equal(decideNotificationCancel("processing").kind, "in_flight");
  assert.equal(decideNotificationCancel("failed").kind, "cancel");
  assert.equal(decideNotificationCancel(null).kind, "cancel");
});

test("SA-051..055 terms lifecycle", () => {
  const draft = parseTermsDraftInput({ version_label: " v1 ", body_markdown: "body" });
  assert.deepEqual(draft, { ok: true, draft: { version_label: "v1", body_markdown: "body", severity: "minor" } });
  assert.equal(parseTermsDraftInput({ version_label: "", body_markdown: "b" }).ok, false);
  assert.deepEqual(decideTermsPublish("archived"), { kind: "rejected", message: "アーカイブ済みの規約は再公開できません。" });
  assert.deepEqual(decideTermsPublish("published"), { kind: "already_published" });
  assert.deepEqual(decideTermsPublish("draft"), { kind: "publish" });
  assert.equal(nextTermsPublishedAt(100, 100), 101);
  assert.equal(nextTermsPublishedAt(100, null), 100);
  assert.deepEqual(parseTermsReacceptBroadcastInput({ termsId: "t", confirm: "TERMS", cursor: null, content: ` ${"n".repeat(1200)}` }), {
    ok: true, termsId: "t", cursor: "", content: "n".repeat(1000),
  });
  assert.equal(parseTermsReacceptBroadcastInput({ termsId: "t", confirm: "terms", cursor: "", content: "" }).message, "確認文字列 'TERMS' が一致しません。");
  assert.equal(parseTermsReacceptBroadcastInput({ termsId: "t", confirm: "TERMS", cursor: "c".repeat(129), content: "" }).message, "cursor が長すぎます。");
});

// The only producer is <input type="datetime-local" name="due_at"> in
// src/components/admin/CreateModerationCaseForm.tsx (YYYY-MM-DDTHH:mm[:ss]).
test("SA-043 parseModerationDueAt keeps datetime-local values as JST", () => {
  assert.equal(parseModerationDueAt("2026-05-30T12:00"), 1780110000);
  assert.equal(parseModerationDueAt("2026-05-30T12:00:30"), 1780110030);
  assert.equal(parseModerationDueAt(" 2026-01-01T00:00 "), Date.UTC(2025, 11, 31, 15, 0) / 1000);
  assert.equal(parseModerationDueAt("2028-02-29T23:59"), Date.UTC(2028, 1, 29, 14, 59) / 1000);
  assert.equal(parseModerationDueAt(""), null);
  assert.equal(parseModerationDueAt("   "), null);
  assert.equal(parseModerationDueAt(null), null);
  assert.equal(parseModerationDueAt(undefined), null);
});

test("SA-043 parseModerationDueAt rejects calendar overflow instead of normalising it", () => {
  for (const bad of [
    "2026-02-30T10:00",
    "2027-02-29T10:00",
    "2026-04-31T00:00",
    "2026-13-01T00:00",
    "2026-00-10T00:00",
    "2026-01-00T00:00",
    "2026-01-01T24:00",
    "2026-01-01T23:60",
    "2026-01-01T23:59:60",
  ]) {
    assert.equal(parseModerationDueAt(bad), null, bad);
  }
});

test("SA-043 parseModerationDueAt has no Date.parse fallback for other formats", () => {
  for (const bad of [
    "not-date",
    "2026-01-01",
    "2026-01-01T00:00Z",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00+09:00",
    "2026/01/01 10:00",
    "Jan 1, 2026",
    "1767193200",
  ]) {
    assert.equal(parseModerationDueAt(bad), null, bad);
  }
});
