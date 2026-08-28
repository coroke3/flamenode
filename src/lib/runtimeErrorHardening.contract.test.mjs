import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");

const [
  middlewareSource,
  reuseSource,
  trendingSource,
  aboutStatsSource,
  staffSource,
  suggestionsSource,
  suggestionsV2Source,
  visibilityManifestSource,
] = await Promise.all([
  read("middleware.ts"),
  read("src/lib/event/eventIdReuse.ts"),
  read("src/lib/publicData/trendingLoader.ts"),
  read("app/api/public/about-stats/route.ts"),
  read("app/api/public/events/[id]/staff/route.ts"),
  read("src/lib/video/memberSuggestionsLoader.ts"),
  read("src/lib/video/memberSuggestionsV2Loader.ts"),
  read("src/lib/publicData/publicVisibilityManifest.ts"),
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

test("oversize R2 early returnはpublic/media/autocompleteでbodyを解放する", () => {
  assert.match(aboutStatsSource, /cancelR2BodyBestEffort\(object\)/);
  assert.match(staffSource, /cancelR2BodyBestEffort\(object\)/);
  assert.match(suggestionsSource, /cancelR2BodyBestEffort\(manifestObject\)/);
  assert.match(suggestionsSource, /cancelR2BodyBestEffort\(indexObject\)/);
  assert.match(suggestionsV2Source, /cancelR2BodyBestEffort\(object\)/);
});

test("visibility manifestは既知R2 sizeなら本文を再encodeしない", () => {
  assert.match(visibilityManifestSource, /const hasKnownSize = typeof object\.size === "number"/);
  assert.match(visibilityManifestSource, /!hasKnownSize && utf8ByteLength\(text\)/);
  assert.match(visibilityManifestSource, /cancelR2BodyBestEffort\(object\)/);
});
