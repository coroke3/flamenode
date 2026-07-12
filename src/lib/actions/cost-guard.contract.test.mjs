import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const action = await readFile(new URL("./cost-guard.ts", import.meta.url), "utf8");
const normalUi = await readFile(new URL("../../components/admin/CostGuardForm.tsx", import.meta.url), "utf8");
const overrideUi = await readFile(new URL("../../components/admin/CostGuardOverrideForm.tsx", import.meta.url), "utf8");

test("all normal CostGuard writes use common guard and atomic full audit", () => {
  for (const name of ["setCostGuardMode", "setMaintenanceMode", "setAutoCostGuard", "setCostGuardAdvancedSettings"]) {
    assert.match(action, new RegExp(`export async function ${name}`));
  }
  assert.ok((action.match(/normalAdmin\(\)/g) ?? []).length >= 4);
  assert.match(action, /requireAdminWrite\(feature\)/);
  assert.match(action, /mutateWithAudit\(input\.db/);
  assert.match(action, /expectedRowCondition/);
  assert.match(action, /before: \{ \.\.\.input\.before \}/);
  assert.match(action, /after: \{ \.\.\.after \}/);
  assert.doesNotMatch(action, /auditAction\(/);
  assert.doesNotMatch(action, /await db\.(?:insert|update|delete)/);
});

test("override is a separate, short, confirmed and allowlisted emergency operation", () => {
  assert.match(action, /requireCostGuardOverrideAdmin\(\)/);
  assert.match(action, /OVERRIDE_DURATION_SEC = 15 \* 60/);
  assert.match(action, /confirm !== "OVERRIDE"/);
  assert.match(action, /confirm !== "CLEAR"/);
  assert.match(action, /candidates\.every\(isWriteFeatureKey\)/);
  assert.match(action, /context: "cost_guard_override_enable"/);
  assert.match(action, /context: "cost_guard_override_clear"/);
  assert.doesNotMatch(normalUi, /exception_until|exception_features_json|一時例外/);
  assert.match(overrideUi, /setCostGuardOverride/);
  assert.match(overrideUi, /clearCostGuardOverride/);
  assert.match(overrideUi, /15分限定/);
});
