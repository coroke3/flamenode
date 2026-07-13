import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [
  securityChecks,
  spreadsheetDiscovery,
  xIdMergeImpact,
  permissionIntegrityChecks,
  liveApi,
  publicDataLoader,
] = await Promise.all([
  readFile(new URL("./securityChecks.ts", import.meta.url), "utf8"),
  readFile(new URL("./spreadsheet/discovery.ts", import.meta.url), "utf8"),
  readFile(new URL("./xIdMergeImpact.ts", import.meta.url), "utf8"),
  readFile(new URL("./permissionIntegrityChecks.ts", import.meta.url), "utf8"),
  readFile(new URL("../staticRebuild/liveApi.ts", import.meta.url), "utf8"),
  readFile(new URL("../publicData/loader.ts", import.meta.url), "utf8"),
]);

test("セキュリティ検査はLIMIT後の配列長ではなく全件数を返す", () => {
  assert.doesNotMatch(securityChecks, /const count = rows\.length/);
  assert.ok(
    (securityChecks.match(/COUNT\(\*\) OVER\(\)/g) ?? []).length >= 6,
    "サンプル上限と全件数を単一クエリで取得する",
  );
  assert.match(securityChecks, /runCheckSafely/);
  assert.doesNotMatch(securityChecks, /\?\?\?\?\?/);
});

test("表計算カタログの同時更新は単一Promiseへ集約する", () => {
  assert.match(spreadsheetDiscovery, /catalogRefresh/);
  assert.match(spreadsheetDiscovery, /cacheGeneration/);
  assert.match(spreadsheetDiscovery, /if \(catalogRefresh\)/);
  assert.doesNotMatch(
    spreadsheetDiscovery,
    /Promise\.resolve\(getDrizzleSchemaTableNames\(\)\)/,
  );
});

test("X ID統合影響件数は単一DB読取で取得する", () => {
  assert.doesNotMatch(xIdMergeImpact, /Promise\.all/);
  assert.equal(
    (xIdMergeImpact.match(/SELECT COUNT\(\*\)/g) ?? []).length,
    9,
  );
  assert.match(xIdMergeImpact, /impact_source/);
});

test("権限整合性検査は独立読取を並列化し総件数を保持する", () => {
  assert.match(
    permissionIntegrityChecks,
    /const \[sqlChecks, duplicateX, duplicateUser, staffRows\] = await Promise\.all/,
  );
  assert.ok(
    (permissionIntegrityChecks.match(/COUNT\(\*\) OVER\(\)/g) ?? []).length >= 2,
  );
  assert.match(permissionIntegrityChecks, /permission_preset IN \('owner', 'manager', 'custom'\)/);
  assert.match(permissionIntegrityChecks, /moreCount: Math\.max/);
});

test("ライブAPIはイベント存在確認を各データ読取へ統合する", () => {
  assert.doesNotMatch(liveApi, /eventExists/);
  assert.ok((liveApi.match(/\.from\(events\)/g) ?? []).length >= 3);
  assert.ok((liveApi.match(/SELECT COUNT\(\*\)/g) ?? []).length >= 4);
  assert.match(liveApi, /\.leftJoin\(slots, eq\(slots\.event_id, events\.id\)\)/);
});

test("公開静的JSONは同時読取を集約しR2とenqueue障害を分離する", () => {
  assert.match(publicDataLoader, /staticReadInFlight/);
  assert.match(publicDataLoader, /read_failed/);
  assert.match(publicDataLoader, /enqueue_failed/);
  assert.match(publicDataLoader, /if \(payload !== null\)/);
});
