/**
 * /list?event= degraded path contract.
 *
 * Usage: node --test src/lib/publicData/listEventPage.contract.test.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDegradedEventListPageSql } from "./degradedEventListPageSql.ts";

const listPageSource = await readFile(
  new URL("../../../app/(public)/list/page.tsx", import.meta.url),
  "utf8",
);
const loaderSource = await readFile(new URL("./loader.ts", import.meta.url), "utf8");
const degradedSource = await readFile(
  new URL("./degradedQueries.ts", import.meta.url),
  "utf8",
);

test("event 指定時は degraded event list loader を呼ぶ", () => {
  assert.match(listPageSource, /loadPublicEventVideosPage/);
  assert.match(listPageSource, /eventListLoad/);
  assert.match(loaderSource, /fetchDegradedEventListPage/);
  assert.match(loaderSource, /canAttemptDegradedD1/);
});

test("degraded event list SQL は COUNTABLE 条件と LIMIT を含む", () => {
  const sql = buildDegradedEventListPageSql("new");
  assert.match(sql, /COUNTABLE|visibility_status = 'public'/);
  assert.match(sql, /LIMIT \? OFFSET \?/);
  assert.doesNotMatch(sql, /COUNT\(\*\) OVER/i);
  assert.match(sql, /v\.creator_display_name/);
  assert.match(sql, /v\.creator_icon_url/);
  assert.doesNotMatch(sql, /x_users|xu\.x_name|xu\.icon_url/i);
  assert.match(degradedSource, /fetchDegradedEventListPage/);
  assert.match(degradedSource, /\.limit\(fetchLimit\)/);
});
