import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const actionSources = await Promise.all(
  [
    ["chapter", new URL("./chapter.ts", import.meta.url), 4],
    ["slot", new URL("./slot.ts", import.meta.url), 4],
    ["interaction", new URL("./video/interaction.ts", import.meta.url), 1],
    ["cost-guard", new URL("./cost-guard.ts", import.meta.url), 5],
  ].map(async ([name, url, expectedReuseCount]) => ({
    name,
    expectedReuseCount,
    source: await readFile(url, "utf8"),
  })),
);

test("認証済みwrite actionは同じrequest-local D1 bindingを再利用する", () => {
  for (const { name, expectedReuseCount, source } of actionSources) {
    assert.equal(
      (source.match(/const db = guard\.db;/g) ?? []).length,
      expectedReuseCount,
      `${name} の全write actionがguard.dbを使う`,
    );
    assert.doesNotMatch(
      source,
      /const db = getDatabase\(\)/,
      `${name} は認証後にD1 bindingを再解決しない`,
    );
  }
});
