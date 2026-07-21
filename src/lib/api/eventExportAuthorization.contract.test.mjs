import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [route, eventAction, cache] = await Promise.all([
  readFile(
    new URL("../../../app/api/event-endpoints/[id]/route.ts", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../actions/event-admin.ts", import.meta.url), "utf8"),
  readFile(new URL("./eventExportCache.ts", import.meta.url), "utf8"),
]);

test("scheduled payload cache HIT前にもD1の公開可否を検査する", () => {
  const d1Gate = route.indexOf("await loadEventExportEvent(db, eventId)");
  const cacheHit = route.indexOf("const [response] = await Promise.all([cachedResponse()");
  assert.ok(d1Gate >= 0 && cacheHit >= 0 && d1Gate < cacheHit);
  assert.doesNotMatch(route, /kv\.get\(accessKey\)/);
  assert.match(route, /event\.public_api_enabled === 1/);
  assert.match(route, /event\.visibility_status === "public"/);
  assert.doesNotMatch(route, /export const runtime = "edge"/);
});

test("イベントprivate化後はaccessと全payload cacheを無効化する", () => {
  assert.match(
    eventAction,
    /if \(after\.visibility_status !== "public"\) \{\s*await invalidateEventExportCache\(data\.id\)/,
  );
  assert.match(eventAction, /await invalidateEventExportCache\(eventId\)/);
  assert.match(cache, /eventExportAccessCacheKey\(eventId\)/);
  assert.match(cache, /EVENT_EXPORT_REFRESH_MINUTES\.map/);
});
