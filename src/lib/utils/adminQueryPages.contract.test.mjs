import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { firstSearchParamValue } from "./next.ts";

const readPage = (path) =>
  readFile(new URL(`../../../app/(admin)/admin/${path}/page.tsx`, import.meta.url), "utf8");

test("admin query normalizer accepts repeated and missing search parameters", () => {
  assert.equal(firstSearchParamValue(" events "), "events");
  assert.equal(firstSearchParamValue([" events ", "users"]), "events");
  assert.equal(firstSearchParamValue(["", "users"]), "");
  assert.equal(firstSearchParamValue([]), "");
  assert.equal(firstSearchParamValue(undefined), "");
  assert.equal(firstSearchParamValue(null), "");
});

test("CURRENT admin spreadsheet table filter normalizes repeated query values", async () => {
  const source = await readPage("spreadsheet");
  assert.match(source, /import \{ firstSearchParamValue, type SearchParamValue \} from "#utils\/next"/);
  assert.match(source, /table\?: SearchParamValue/);
  assert.match(source, /const initialTable = firstSearchParamValue\(sp\.table\) \|\| undefined/);
  assert.doesNotMatch(source, /\(sp\.table \?\? ""\)\.trim\(\)/);
});

test("CURRENT admin permission simulator normalizes repeated ID query values", async () => {
  const source = await readPage("permissions/simulator");
  assert.match(source, /import \{ firstSearchParamValue, type SearchParamValue \} from "#utils\/next"/);
  assert.match(source, /event_id\?: SearchParamValue; x_user_id\?: SearchParamValue/);
  assert.match(source, /const eventId = firstSearchParamValue\(sp\.event_id\)/);
  assert.match(source, /const xUserId = firstSearchParamValue\(sp\.x_user_id\)/);
});
