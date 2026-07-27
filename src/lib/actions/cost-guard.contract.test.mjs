import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const action = await readFile(new URL("./cost-guard.ts", import.meta.url), "utf8");
const normalUi = await readFile(new URL("../../components/admin/CostGuardForm.tsx", import.meta.url), "utf8");
const overrideUi = await readFile(new URL("../../components/admin/CostGuardOverrideForm.tsx", import.meta.url), "utf8");
const contentJobs = await readFile(new URL("../../../workers/content-jobs/index.ts", import.meta.url), "utf8");

test("all manual CostGuard control writes use the dedicated control guard and atomic full audit", () => {
  for (const name of ["setCostGuardMode", "setMaintenanceMode"]) {
    assert.match(action, new RegExp(`export async function ${name}`));
  }
  assert.ok((action.match(/requireCostGuardControlAdmin\(\)/g) ?? []).length >= 4);
  assert.match(action, /mutateWithAudit\(input\.db/);
  assert.match(action, /expectedRowCondition/);
  assert.match(action, /before: \{ \.\.\.input\.before \}/);
  assert.match(action, /after: \{ \.\.\.after \}/);
  assert.doesNotMatch(action, /auditAction\(/);
  assert.doesNotMatch(action, /await db\.(?:insert|update|delete)/);
  assert.doesNotMatch(action, /setAutoCostGuard|setCostGuardAdvancedSettings/);
  assert.match(action, /z\.enum\(\["normal", "economy", "read_only", "static_only"\]\)/);
  assert.match(action, /writeOperationModeKvMirror/);
  assert.match(action, /KV複製の更新に失敗/);
  assert.equal(
    (action.match(/warning \? \{ warning, message: warning \} : \{\}/g) ?? []).length,
    2,
    "mode と maintenance の両方でKV複製失敗を現行フォームのmessageへ表示する",
  );
  assert.doesNotMatch(normalUi, /\["maintenance", "メンテナンス"\]/);
});

test("override is a separate, short, confirmed and allowlisted emergency operation", () => {
  assert.match(action, /requireCostGuardControlAdmin\(\)/);
  assert.match(action, /OVERRIDE_DURATION_SEC = 15 \* 60/);
  assert.match(action, /confirm !== "OVERRIDE"/);
  assert.match(action, /confirm !== "CLEAR"/);
  assert.match(action, /candidates\.every\(isWriteFeatureKey\)/);
  assert.match(action, /context: "cost_guard_override_enable"/);
  assert.match(action, /context: "cost_guard_override_clear"/);
  assert.doesNotMatch(normalUi, /exception_until|exception_features_json|一時例外/);
  assert.doesNotMatch(normalUi, /自動コストガード|閾値/);
  assert.doesNotMatch(contentJobs, /applyAutoCostGuard|cost-guard\/auto/);
  assert.match(overrideUi, /setCostGuardOverride/);
  assert.match(overrideUi, /clearCostGuardOverride/);
  assert.match(overrideUi, /15分限定/);
});

test("control guard skips Active X lookup while keeping identity checks", async () => {
  const guard = await readFile(new URL("../auth/writeGuard.ts", import.meta.url), "utf8");
  const control = guard.slice(guard.indexOf("export async function requireCostGuardControlAdmin"));
  assert.match(control, /evaluateWriteIdentity\(user, "admin"\)/);
  assert.match(control, /activeXId: null/);
  assert.match(control, /approvedXIds: \[\]/);
  assert.doesNotMatch(control, /getApprovedXIds\(/);
});
