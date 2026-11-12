import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readSingleSearchParam } from "../src/lib/utils/singleSearchParam.ts";
import { parseUsersIndexPage } from "../src/lib/publicData/usersIndexPage.ts";

const source = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("public list queries: repeated and malformed search keys are treated as absent", () => {
  for (const input of [undefined, null, ["first", "second"], ["first"], 2, false, {}]) {
    assert.equal(readSingleSearchParam(input), "");
  }
  assert.equal(readSingleSearchParam("  hello  "), "  hello  ", "scalar whitespace is preserved for page-specific trim behavior");
  assert.equal(readSingleSearchParam("絵文字😀"), "絵文字😀");
  assert.equal(readSingleSearchParam(""), "");
});

test("CURRENT /user: q is normalized before v2 and legacy search; sort/page remain bounded", () => {
  const current = source("app/(public)/user/UserIndexView.tsx");
  assert.match(current, /q: rawQuery/);
  assert.match(current, /const q = readSingleSearchParam\(rawQuery\)/);
  assert.match(current, /q: q\.trim\(\) \|\| undefined/);
  assert.match(current, /prepareUsersIndexItems\(staticLoaded\.index\.items, q, sortKey\)/);
  assert.match(current, /parseUsersIndexPage\(page\)/);
  assert.match(current, /function parseUsersIndexSort\(value: unknown\)/);
  assert.equal(parseUsersIndexPage(["2", "3"]), 1);
  assert.equal(parseUsersIndexPage("2"), 2);
});

test("CURRENT /event: repeated q cannot reach trim; scalar behavior is unchanged", () => {
  const current = source("app/(public)/event/EventIndexView.tsx");
  assert.match(current, /const q = readSingleSearchParam\(rawParams\.q\)\.trim\(\)/);
  assert.match(current, /const query = q\.toLocaleLowerCase\(\)/);
  assert.match(current, /function parseEventFilterStatus\(value: unknown\)/);
  assert.match(current, /function parseEventFilterSort\(value: unknown\)/);
  assert.equal(readSingleSearchParam(["test", "other"]).trim(), "");
  assert.equal(readSingleSearchParam("  Event Name ").trim(), "Event Name");
});
