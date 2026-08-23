import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const routePath = new URL("../../../app/api/event-endpoints/[id]/release/route.ts", import.meta.url);
const source = fs.readFileSync(routePath, "utf8");

test("event release API keeps the one-point permission lookup and static loader boundary", () => {
  assert.match(source, /checkPublicApiRateLimit\(request, "\/api\/event-endpoints\/:id\/release"\)/);
  assert.match(source, /eq\(events\.visibility_status, "public"\)/);
  assert.match(source, /eq\(events\.public_api_enabled, 1\)/);
  assert.match(source, /\.limit\(1\)/);
  assert.match(source, /loadStaticEventRelease\(event\.id\)/);
  assert.doesNotMatch(source, /loadEventExportSnapshot|video_events|video_custom_answers/);
});

test("event release API fails closed for malformed IDs and unavailable data", () => {
  assert.match(source, /decodeURIComponent/);
  assert.match(source, /publicServiceUnavailableResponse/);
  assert.match(source, /loaded\.state === "reflecting"/);
  assert.match(source, /public_data_unavailable/);
});
