import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./eventExportData.ts", import.meta.url), "utf8");

test("大規模event export relationはJSON1 1-bindでD1 query数を固定する", () => {
  assert.match(source, /EVENT_EXPORT_VIDEO_IDS_IN_ARRAY_MAX = 80/);
  assert.match(source, /export function eventExportVideoIdsWhere/);
  assert.match(source, /if \(unique\.length <= EVENT_EXPORT_VIDEO_IDS_IN_ARRAY_MAX\)/);
  assert.match(source, /FROM json_each\(\$\{JSON\.stringify\(unique\)\}\)/);
  assert.match(source, /CAST\(event_export_video_ids\.value AS TEXT\) = \$\{column\}/);
  assert.doesNotMatch(source, /loadRowsByVideoIdChunks/);
  assert.doesNotMatch(source, /EVENT_EXPORT_VIDEO_ID_CHUNK_SIZE/);
});

test("5 relationは各1 queryのpredicateを共有せず列ごとに生成する", () => {
  for (const table of [
    "videoMembers",
    "videoSoftwares",
    "videoCustomAnswers",
    "videoChapters",
    "videoEvents",
  ]) {
    assert.match(
      source,
      new RegExp(`eventExportVideoIdsWhere\\(\\s*${table}\\.video_id,\\s*videoIds`),
      table,
    );
  }
  assert.doesNotMatch(source, /for \(\s*let offset = 0;[\s\S]*videoIds\.length/);
});
