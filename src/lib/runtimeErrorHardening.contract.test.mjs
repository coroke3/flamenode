import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const [middlewareSource, reuseSource, trendingSource, aboutStatsSource, staffSource] =
  await Promise.all([
    read("../../middleware.ts"),
    read("./event/eventIdReuse.ts"),
    read("./publicData/trendingLoader.ts"),
    read("../app/api/public/about-stats/route.ts").catch(() => ""),
    read("../app/api/public/events/[id]/staff/route.ts").catch(() => ""),
  ]);

test("middlewareはrequest context由来Promiseをisolate globalへ保持しない", () => {
  assert.doesNotMatch(middlewareSource, /configuredSiteOriginPromise/);
  assert.match(middlewareSource, /let configuredSiteOrigin: string \| undefined/);
});

test("event ID再利用のR2存在確認はGETではなくHEADを使う", () => {
  assert.match(reuseSource, /\.map\(\(key\) => bucket\.head\(key\)\)/);
  assert.doesNotMatch(reuseSource, /\.map\(\(key\) => bucket\.get\(key\)\)/);
});

test("trending artifactはJSON parse前にbyte上限を検査する", () => {
  assert.match(trendingSource, /TRENDING_MAX_OBJECT_BYTES/);
  assert.match(trendingSource, /object\.size > TRENDING_MAX_OBJECT_BYTES/);
  assert.match(trendingSource, /cancelR2BodyBestEffort\(object\)/);
  assert.ok(
    trendingSource.indexOf("object.size > TRENDING_MAX_OBJECT_BYTES") <
      trendingSource.indexOf("object.json()"),
  );
});

test("small public R2 routesもoversize bodyを解放してからreturnする", () => {
  assert.match(aboutStatsSource, /cancelR2BodyBestEffort\(object\)/);
  assert.match(staffSource, /cancelR2BodyBestEffort\(object\)/);
});
