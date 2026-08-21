import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [route, eventAction, cache, eventExportData] = await Promise.all([
  readFile(
    new URL("../../../app/api/event-endpoints/[id]/route.ts", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../actions/event-admin.ts", import.meta.url), "utf8"),
  readFile(new URL("./eventExportCache.ts", import.meta.url), "utf8"),
  readFile(new URL("./eventExportData.ts", import.meta.url), "utf8"),
]);

test("scheduled payload cache HIT前にもD1の公開可否を検査する", () => {
  const d1Gate = route.indexOf("await loadEventExportEvent(db, eventId)");
  const cacheHit = route.indexOf("const response = await cachedResponse()");
  assert.ok(d1Gate >= 0 && cacheHit >= 0 && d1Gate < cacheHit);
  assert.doesNotMatch(route, /kv\.get\(accessKey\)/);
  assert.doesNotMatch(route, /kv\.put\(accessKey/);
  assert.match(route, /event\.public_api_enabled === 1/);
  assert.match(route, /event\.visibility_status === "public"/);
  assert.doesNotMatch(route, /export const runtime = "edge"/);
});

test("イベントprivate化後は全payload cacheを無効化する", () => {
  assert.match(
    eventAction,
    /if \(visibilityTransition\.fenceToken \|\| after\.visibility_status !== "public"\) \{[\s\S]*?await invalidateEventExportCache\(data\.id\)/,
  );
  assert.match(eventAction, /await invalidateEventExportCache\(eventId\)/);
  assert.doesNotMatch(cache, /eventExportAccessCacheKey/);
  assert.match(cache, /EVENT_EXPORT_REFRESH_MINUTES\.map/);
});

test("イベント出力の関連行取得はD1 bind上限未満へ分割する", () => {
  const chunkSizeMatch = eventExportData.match(
    /EVENT_EXPORT_VIDEO_ID_CHUNK_SIZE\s*=\s*(\d+)/,
  );
  assert.ok(chunkSizeMatch);
  const chunkSize = Number(chunkSizeMatch[1]);
  assert.equal(chunkSize, 90);
  assert.ok(chunkSize + 3 < 100, "固定条件の追加bindを含めても100未満");

  const sampleIds = Array.from({ length: 500 }, (_, index) => String(index));
  const chunks = [];
  for (let offset = 0; offset < sampleIds.length; offset += chunkSize) {
    chunks.push(sampleIds.slice(offset, offset + chunkSize));
  }
  assert.equal(chunks.length, 6);
  assert.ok(chunks.every((chunk) => chunk.length <= 90));

  assert.match(eventExportData, /async function loadRowsByVideoIdChunks/);
  assert.equal(
    (eventExportData.match(/loadRowsByVideoIdChunks\(videoIds/g) ?? []).length,
    5,
  );
  assert.equal(
    (eventExportData.match(/inArray\([^,]+,\s*chunk\)/g) ?? []).length,
    5,
  );
  assert.doesNotMatch(eventExportData, /inArray\([^,]+,\s*videoIds\)/);
});

test("イベント出力はrequest境界を越えてD1 Promiseを共有しない", () => {
  assert.doesNotMatch(route, /inFlightExports|buildPayloadOnce/);
  assert.doesNotMatch(route, /new Map<string,\s*Promise/);
  assert.match(route, /(?:const snapshot|snapshot) = await loadEventExportSnapshot/);
  assert.match(route, /let body: string \| null = null/);
  assert.match(route, /body = JSON\.stringify\(payload\)/);
});

test("公開exportの不正なpath/D1障害はfail-closed応答にする", () => {
  assert.match(route, /function decodePathSegment\(/);
  assert.match(route, /catch \{\s*return null;/);
  assert.match(route, /if \(!eventId\) return notFoundResponse\(req\)/);
  assert.match(route, /event lookup failed/);
  assert.match(route, /snapshot query failed/);
  assert.match(route, /\{ error: "database_unavailable" \}[\s\S]*?"no-store"[\s\S]*?503/);
  assert.match(route, /assertNoForbiddenKeys\(payload\)/);
});
