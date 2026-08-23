import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../../app/api/event-endpoints/[id]/route.ts", import.meta.url),
  "utf8",
);

test("旧イベント出力URLのlegacy aliasesをcanonical legacyへ寄せる", () => {
  assert.match(
    route,
    /value === "legacy" \|\| value === "old" \|\| value === "v1"/,
  );
  assert.match(route, /return "legacy";/);
});

test("旧new/economy aliasesは現行v5/scheduledへ安全に正規化する", () => {
  assert.match(
    route,
    /value == null \|\| value === "" \|\| value === "v5" \|\| value === "new"/,
  );
  assert.match(route, /value === "scheduled" \|\| value === "economy"/);
  assert.match(route, /return "scheduled";/);
});

test("v2/v3指定をv5へ偽装せず不明formatとして扱う", () => {
  const parseFormat = route.slice(
    route.indexOf("function parseFormat"),
    route.indexOf("function parseUpdateMode"),
  );
  assert.doesNotMatch(parseFormat, /value === "v2"/);
  assert.doesNotMatch(parseFormat, /value === "v3"/);
});

test("エラー応答はaliasesではなく推奨canonical値だけを案内する", () => {
  assert.match(route, /allowed: \["v5", "legacy"\]/);
  assert.match(route, /update: \["realtime", "scheduled"\]/);
});
