import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [helper, overview, audience, videos, slots] = await Promise.all([
  readFile(new URL("./manageEventRender.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../../app/(manage)/manage/events/[id]/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../../../app/(manage)/manage/events/[id]/audience/page.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../../../app/(manage)/manage/events/[id]/videos/page.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../../../app/(manage)/manage/events/[id]/slots/page.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("manage event render loader is request-local and projection-only", () => {
  assert.match(helper, /import \{ cache \} from "react"/);
  assert.match(helper, /export const getManageEventForRender = cache\(/);
  assert.doesNotMatch(helper, /unstable_cache|use cache|Next\.cache/);
  assert.match(helper, /slot_part_gap_minutes: events\.slot_part_gap_minutes/);
});

test("manage event metadata and slots page share the render loader", () => {
  for (const source of [overview, audience, videos, slots]) {
    assert.match(source, /getManageEventForRender/);
  }
  assert.match(slots, /const event = await getManageEventForRender\(id\)/);
  assert.doesNotMatch(
    slots,
    /db\.select\(\)\.from\(eventsTable\)\.where\(eq\(eventsTable\.id, id\)\)/,
  );
});
