import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./eventExportData.ts", import.meta.url), "utf8");

test("公開event exportはvideo_events欠落時もprimary_event_idで作品を落とさない", () => {
  assert.match(source, /\.from\(videos\)[\s\S]*?\.leftJoin\([\s\S]*?videoEvents/);
  assert.match(source, /eq\(videoEvents\.event_id, eventId\)/);
  assert.match(source, /or\([\s\S]*?eq\(videoEvents\.event_id, eventId\)[\s\S]*?eq\(videos\.primary_event_id, eventId\)/);
});

test("primary fallbackのevent_ids補完は現在の公開対象eventだけに限定する", () => {
  assert.match(source, /video\.primary_event_id === eventId/);
  assert.match(source, /!publicRelationIds\.includes\(eventId\)/);
  assert.doesNotMatch(source, /event_ids:\s*\[[^\]]*video\.primary_event_id/);
});
