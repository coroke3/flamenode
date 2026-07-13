import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { planD1AuditMutationBudget } from "../audit/mutateBudget.ts";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("header X ID read pathは未連携active行を自動claimしない", () => {
  const source = read("./headerXIds.ts");
  assert.doesNotMatch(source, /\.update\(xUsers\)/);
  assert.doesNotMatch(source, /or\(\.\.\.rowConditions/);
  assert.match(source, /where\(eq\(xUsers\.linked_user_id, userId\)\)/);
});

test("Discord auth linkは内部user ID更新・token消去・監査を単一batchにする", () => {
  const source = read("./index.ts");
  assert.match(source, /await mutateWithAudit\(eventDb,/);
  assert.match(source, /expectedRowCondition\(\{ expectedCurrent: beforeUser \}\)/);
  assert.match(source, /expectedMutationChanges: \[1, 1\]/);
  assert.match(source, /discord_id: account\.providerAccountId/);
  assert.match(source, /accounts\)\.set\(\{ access_token: null \}\)/);
});

test("一般X ID lifecycleは逐次audit writeを残さずCAS付きatomic batchを使う", () => {
  const source = read("../actions/xid.ts");
  assert.doesNotMatch(source, /auditAction\(/);
  assert.equal((source.match(/await mutateWithAudit\(db,/g) ?? []).length, 6);
  assert.match(source, /expectedRowCondition\(\{ expectedCurrent: row \}\)/);
  assert.match(source, /xicons\/staging/);
  assert.match(source, /Promise\.allSettled\(\[env\.BUCKET\.delete\(stagingKey\), env\.BUCKET\.delete\(key\)\]\)/);
});

test("管理X ID lifecycleは通知を含むatomic batch、merge状態はCAS付き監査を使う", () => {
  const admin = read("../actions/xid-admin.ts");
  const merge = read("../actions/xid-merge-admin.ts");
  assert.doesNotMatch(admin, /auditAction\(|enqueueNotification\(/);
  assert.match(admin, /buildNotificationOutboxStatement/);
  assert.equal((admin.match(/await mutateWithAudit\(db,/g) ?? []).length, 3);
  assert.doesNotMatch(merge, /auditAction\(|Promise\.all/);
  assert.equal((merge.match(/await mutateWithAudit\(db,/g) ?? []).length, 4);
  assert.match(merge, /expectedRowCondition\(\{ expectedCurrent: current \}\)/);
});

test("X ID lifecycleの最大atomic planはD1 50 query以内に収まる", () => {
  const budget = planD1AuditMutationBudget({
    mutationStatementCount: 4,
    mutationAssertionCount: 4,
    auditEntryCount: 3,
    distinctActorCount: 1,
  });
  assert.equal(budget.totalQueryCount, 22);
  assert.equal(budget.withinLimit, true);
  assert.ok(4 * 21 < 100, "最大4行の監査chunkも100 bind未満である");
});
