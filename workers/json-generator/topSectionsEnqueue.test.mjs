import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./topSectionsEnqueue.ts", import.meta.url),
  "utf8",
);

test("top section artifacts は TOP_SECTION_OBJECT_KEYS の head で欠損を検知する", () => {
  assert.match(source, /TOP_SECTION_OBJECT_KEYS/);
  assert.match(source, /TOP_RECOMMENDED_OBJECT_KEY/);
  assert.match(source, /TOP_LATEST_OBJECT_KEY/);
  assert.match(source, /TOP_NOSTALGIC_OBJECT_KEY/);
  assert.match(source, /TOP_EVENTS_OBJECT_KEY/);
  assert.match(source, /TOP_ANNOUNCEMENTS_OBJECT_KEY/);
  assert.match(source, /TOP_STATS_OBJECT_KEY/);
  assert.match(source, /top_recommended/);
  assert.match(source, /top_latest/);
  assert.match(source, /top_nostalgic/);
  assert.match(source, /top_events/);
  assert.match(source, /top_announcements/);
  assert.match(source, /top_stats/);
  assert.match(source, /ensureTopSectionsOnR2/);
  assert.match(source, /env\.R2\.head/);
  assert.doesNotMatch(source, /top_slot_stats/);
});

test("複数top section欠落はJSON1のUPDATE+INSERT 2 statementsへ集約する", () => {
  assert.match(source, /TOP_SECTIONS_REPAIR_MAX_D1_STATEMENTS = 2/);
  assert.match(source, /async function enqueueMissingTopSections/);
  assert.match(source, /FROM json_each\(\?\)/);
  assert.match(source, /env\.DB\.batch\(\[activeUpdate, insert\]\)/);
  assert.doesNotMatch(source, /enqueueTopSectionRebuild/);
});
