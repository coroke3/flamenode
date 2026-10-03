import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./liveGuard.ts", import.meta.url),
  "utf8",
);

test("live API guard converts binding failures to a private 503 response", () => {
  assert.match(source, /const NO_STORE_HEADERS = \{ \"Cache-Control\": \"no-store\" \}/);
  assert.match(source, /try \{\s*db = getDatabase\(\);[\s\S]*?catch \(err\)/);
  assert.match(source, /error: \"db_unavailable\"/);
  assert.match(source, /function jsonErrorResponse\([\s\S]*?headers: NO_STORE_HEADERS/);
});

test("live API guard keeps all non-success branches no-store", () => {
  const errorBranches = source.match(/return jsonErrorResponse\(/g) ?? [];
  assert.ok(errorBranches.length >= 5);
  assert.match(source, /error: \"invalid_event_id\"/);
  assert.match(source, /error: \"live_api_disabled\"/);
  assert.match(source, /error: \"not_found\"/);
  assert.match(source, /error: \"live_api_error\"/);
});

test("live API guard does not query system_settings per request", () => {
  assert.doesNotMatch(source, /systemSettings/);
  assert.doesNotMatch(source, /drizzle-orm/);
  assert.doesNotMatch(source, /\.from\(/);
  assert.match(
    source,
    /resolvePublicOperationMode\(\{ allowD1: true, db \}\)/,
  );
  assert.match(source, /isLiveApiEnabled\(/);
});

test("live API guard checks the operation mode per request before the micro-cache", () => {
  const allowed = source.indexOf("await liveApiAllowed(db)");
  const cacheRead = source.indexOf("isolateMicroCacheGet(microCacheKey)");
  const load = source.indexOf("await load(db, id)");
  assert.ok(allowed >= 0 && cacheRead > allowed && load > cacheRead);
});

test("live API micro-cache stores only successful non-null payload strings", () => {
  assert.match(source, /`live:\$\{routeName\}:\$\{id\}`/);
  const notFound = source.indexOf('error: "not_found"');
  const set = source.indexOf("isolateMicroCacheSet(microCacheKey, body)");
  assert.ok(notFound >= 0 && set > notFound);
  assert.match(source, /body = JSON\.stringify\(payload\)/);
  assert.match(
    source,
    /"Cache-Control": liveApiCacheControl\(\)/,
  );
  assert.match(
    source,
    /return "public, s-maxage=5, stale-while-revalidate=30"/,
  );
});

test("live API routes pass a stable route name for the cache key", async () => {
  for (const name of ["summary", "slots", "submissions"]) {
    const route = await readFile(
      new URL(`../../../app/api/live/events/[id]/${name}/route.ts`, import.meta.url),
      "utf8",
    );
    assert.match(
      route,
      new RegExp(String.raw`handleLiveApiGet\(id, \w+, "${name}"\)`),
    );
  }
});
