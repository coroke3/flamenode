import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [securityChecks, spreadsheetDiscovery, xIdMergeImpact] = await Promise.all([
  readFile(new URL("./securityChecks.ts", import.meta.url), "utf8"),
  readFile(new URL("./spreadsheet/discovery.ts", import.meta.url), "utf8"),
  readFile(new URL("./xIdMergeImpact.ts", import.meta.url), "utf8"),
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
