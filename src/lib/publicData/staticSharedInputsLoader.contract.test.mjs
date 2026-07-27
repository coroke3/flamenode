import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [source, videoPage] = await Promise.all([
  readFile(
    new URL("./staticSharedInputsLoader.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../app/(public)/[id]/page.tsx", import.meta.url),
    "utf8",
  ),
]);

test("共有JSONローダーはrequest外へR2 Promiseを保持しない", () => {
  assert.doesNotMatch(source, /const inFlight = new Map/);
  assert.doesNotMatch(source, /inFlight\.(?:get|set|delete)/);
  assert.match(source, /const object = await bucket\.get\(key\)/);
  assert.match(source, /readPublicJsonCache/);
  assert.match(source, /writePublicJsonCacheBestEffort/);
});

test("random poolもfresh stale unavailableを保持する", () => {
  assert.match(
    source,
    /export async function loadRandomVideoPool\(\): Promise<[\s\S]*StaticJsonLoadResult<RandomVideoPool>/,
  );
  assert.match(source, /status: "unavailable",\s*value: EMPTY_RANDOM_VIDEO_POOL/);
  assert.match(
    source,
    /export async function loadRandomVideoPoolOptional\(\): Promise<RandomVideoPool>/,
  );
  assert.match(source, /return \(await loadRandomVideoPool\(\)\)\.value/);
});

test("動画詳細は共有R2読込後にrequest metricsを記録する", () => {
  const logIndex = videoPage.indexOf("logPublicRequestMetrics();");
  const blocklistIndex = videoPage.indexOf(
    "const blocklist = await loadYoutubeRelatedBlocklist();",
  );
  const randomPoolIndex = videoPage.indexOf(
    "const randomPool = await loadRandomVideoPool();",
  );
  const iconMapIndex = videoPage.indexOf("const iconMapPayload =");

  assert.ok(blocklistIndex >= 0);
  assert.ok(randomPoolIndex >= 0);
  assert.ok(iconMapIndex >= 0);
  assert.ok(logIndex > blocklistIndex);
  assert.ok(logIndex > randomPoolIndex);
  assert.ok(logIndex > iconMapIndex);
});

test("動画詳細は候補0件でも共有JSON障害を正常な空表示へ変換しない", () => {
  assert.match(videoPage, /const blocklist = await loadYoutubeRelatedBlocklist\(\)/);
  assert.doesNotMatch(videoPage, /const needsBlocklist/);
  assert.match(videoPage, /const randomPool = await loadRandomVideoPool\(\)/);
  assert.match(
    videoPage,
    /randomPool\.status === "unavailable"[\s\S]*relatedSharedStatus = "unavailable"/,
  );
  assert.match(
    videoPage,
    /unavailable=\{relatedSharedStatus === "unavailable"\}/,
  );
  assert.match(videoPage, /関連動画用の共有データを一時的に利用できません/);
  assert.match(videoPage, /関連動画はまだありません/);
});
