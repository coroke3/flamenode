import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./topSlotStatsEnqueue.ts", import.meta.url),
  "utf8",
);

test("top slot-stats artifact は TOP_SLOT_STATS_OBJECT_KEY の head で欠損を検知する", () => {
  assert.match(source, /top_slot_stats/);
  assert.match(source, /TOP_SLOT_STATS_OBJECT_KEY/);
  assert.match(source, /ensureTopSlotStatsOnR2/);
  assert.match(source, /env\.R2\.head/);
  assert.match(source, /target_id = 'global'/);
});
