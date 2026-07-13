import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const pkg = JSON.parse(
  await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
);

test("UnitとWorkerテストは重複せず両方実行される", () => {
  assert.match(pkg.scripts["test:unit"], /src\/\*\*\/\*\.test\.mjs/);
  assert.doesNotMatch(pkg.scripts["test:unit"], /workers\//);
  assert.match(pkg.scripts["test:workers"], /workers\/\*\*\/\*\.test\.mjs/);
  assert.match(pkg.scripts["cf:preflight"], /npm run test:unit/);
  assert.match(pkg.scripts["cf:preflight"], /npm run test:workers/);
});
