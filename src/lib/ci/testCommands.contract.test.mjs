import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const pkg = JSON.parse(
  await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
);
const verifyFast = await readFile(
  new URL("../../../scripts/cloudflare-verify-fast.mjs", import.meta.url),
  "utf8",
);

test("UnitとWorkerテストは重複せず両方実行される", () => {
  assert.match(pkg.scripts["test:unit"], /"src\/\*\*\/!\(\*\.integration\)\.test\.mjs"/);
  assert.match(pkg.scripts["test:unit"], /"scripts\/\*\*\/\*\.test\.mjs"/);
  assert.match(pkg.scripts["test:unit"], /"app\/\*\*\/\*\.test\.mjs"/);
  assert.doesNotMatch(pkg.scripts["test:unit"], /workers\//);
  assert.match(pkg.scripts["test:workers"], /"workers\/\*\*\/\*\.test\.mjs"/);
  assert.match(pkg.scripts["test:integration"], /"src\/\*\*\/\*\.integration\.test\.mjs"/);
  assert.match(pkg.scripts["verify:full"], /npm run test:unit/);
  assert.match(pkg.scripts["verify:fast"], /cloudflare-verify-fast\.mjs/);
  assert.match(pkg.scripts["verify:cloud"], /cloudflare-verify-fast\.mjs --cloud/);
  assert.match(pkg.scripts["cf:cloud-build"], /npm run verify:cloud/);
  assert.doesNotMatch(pkg.scripts["cf:cloud-build"], /npm run verify:fast/);
  assert.match(verifyFast, /"test:workers"/);
  assert.match(verifyFast, /CLOUD_BUILD_VERIFY_STEPS/);
  assert.match(pkg.scripts["cf:preflight"], /npm run verify:full/);
});

test("test glob は node が再帰展開するよう引用符で囲む", () => {
  // 引用符なしの ** は npm の sh で * と同じになり、`src/*/x.test.mjs` の深さしか拾わない。
  for (const [name, command] of Object.entries(pkg.scripts)) {
    if (!name.startsWith("test:")) continue;
    assert.doesNotMatch(command.replace(/"[^"]*"/g, ""), /\*\*/, name);
  }
});
