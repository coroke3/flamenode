/**
 * /list?event= degraded path contract.
 *
 * Usage: node --test src/lib/publicData/listEventPage.contract.test.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listPageSource = await readFile(
  new URL("../../../app/(public)/list/ListIndexView.tsx", import.meta.url),
  "utf8",
);
const loaderSource = await readFile(new URL("./loader.ts", import.meta.url), "utf8");
const degradedSource = await readFile(
  new URL("./degradedQueries.ts", import.meta.url),
  "utf8",
);

test("event 指定時は event_base 優先と degraded fallback を呼ぶ", () => {
  assert.match(listPageSource, /loadPublicEventVideosPage/);
  assert.match(listPageSource, /eventListLoad/);
  assert.match(loaderSource, /eventBaseObjectKey/);
  assert.match(loaderSource, /eventComposedObjectKey/);
  assert.match(loaderSource, /isCompleteEventBasePool/);
  assert.match(loaderSource, /eventListPayloadSupportsSort/);
  assert.match(loaderSource, /fetchDegradedEventListPage/);
  assert.match(loaderSource, /canAttemptDegradedD1/);
});

test("oversized event list D1 page は bounded で作品スナップショットのみを返す", () => {
  const fn = degradedSource.slice(
    degradedSource.indexOf("export async function fetchDegradedEventListPage"),
    degradedSource.indexOf("export async function fetchDegradedEventDetailPayload"),
  );
  assert.match(fn, /countablePublicVideoCondition/);
  assert.match(fn, /display_name: creatorNameExpr/);
  assert.match(fn, /icon_url: creatorIconExpr/);
  assert.doesNotMatch(fn, /xUsers/);
  assert.match(degradedSource, /\.limit\(fetchLimit\)/);
  assert.match(
    degradedSource,
    /leftJoin\(\s*events,[\s\S]*visibility_status,\s*\"public\"/,
  );
});

test("/list は artifact miss を 0件ではなく反映中・一時不可として表示する", () => {
  assert.match(listPageSource, /const activeLoad = eventListLoad \?\? staticLoad;/);
  assert.match(listPageSource, /listEmptyMessage\(activeLoad\?\.state, Boolean\(event\)\)/);
  assert.match(listPageSource, /shouldPublicPageShowReflection\(state\)/);
  assert.match(listPageSource, /shouldPublicPageShowUnavailable\(state\)/);
  assert.match(listPageSource, /作品一覧への反映を準備しています/);
});
