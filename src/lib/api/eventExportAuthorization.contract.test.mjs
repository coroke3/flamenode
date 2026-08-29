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

test("scheduled payload cache HIT前にもD1の公開可否とpayload境界を検査する", () => {
  const d1Gate = route.indexOf("await loadEventExportEvent(db, eventId)");
  const cacheHit = route.indexOf("const response = await cachedResponse()");
  assert.ok(d1Gate >= 0 && cacheHit >= 0 && d1Gate < cacheHit);
  assert.doesNotMatch(route, /kv\.get\(accessKey\)/);
  assert.doesNotMatch(route, /kv\.put\(accessKey/);
  assert.match(route, /event\.public_api_enabled === 1/);
  assert.match(route, /event\.visibility_status === "public"/);
  assert.match(
    route,
    /async function readCachedPayload[\s\S]*assertNoForbiddenKeys\(parsed\)/,
  );
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

test("イベント出力の関連行取得は小規模IN・大規模JSON1 1-bindでD1 query数を固定する", () => {
  const thresholdMatch = eventExportData.match(
    /EVENT_EXPORT_VIDEO_IDS_IN_ARRAY_MAX\s*=\s*(\d+)/,
  );
  assert.ok(thresholdMatch);
  assert.equal(Number(thresholdMatch[1]), 80);

  assert.match(eventExportData, /export function eventExportVideoIdsWhere/);
  assert.match(
    eventExportData,
    /unique\.length <= EVENT_EXPORT_VIDEO_IDS_IN_ARRAY_MAX[\s\S]*inArray\(column, unique\)/,
  );
  assert.match(eventExportData, /json_each\(\$\{JSON\.stringify\(unique\)\}\)/);
  assert.doesNotMatch(eventExportData, /EVENT_EXPORT_VIDEO_ID_CHUNK_SIZE/);
  assert.doesNotMatch(eventExportData, /loadRowsByVideoIdChunks/);

  assert.equal(
    (eventExportData.match(/eventExportVideoIdsWhere\(\s*video(?:Members|Softwares|CustomAnswers|Chapters|Events)\.video_id,/g) ?? []).length,
    5,
  );
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

test("公開APIは公開イベントのreview回答も出力しprivate回答は除外する", () => {
  assert.match(
    eventExportData,
    /inArray\(eventCustomQuestions\.visibility, \["public", "review"\]\)/,
  );
  assert.doesNotMatch(
    eventExportData,
    /eq\(eventCustomQuestions\.visibility, "public"\)/,
  );
});
