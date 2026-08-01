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
  assert.match(source, /coercePublicJsonCacheEnvelope/);
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
  const iconMapIndex = videoPage.indexOf("let iconMapPayload =");

  assert.ok(blocklistIndex >= 0);
  assert.ok(randomPoolIndex >= 0);
  assert.ok(iconMapIndex >= 0);
  assert.ok(logIndex > blocklistIndex);
  assert.ok(logIndex > randomPoolIndex);
  assert.ok(logIndex > iconMapIndex);
});

test("公開アイコン補完はrequest内で正規化キーをcacheする", () => {
  assert.match(source, /import \{ cache \} from "react"/);
  assert.match(source, /function buildRequiredXIdsCacheKey/);
  assert.match(source, /ids\.sort\(\)/);
  assert.match(source, /return ids\.join\(","\)/);
  assert.match(source, /const loadPublicXIconMapOptionalImpl = cache\(/);
  assert.match(
    source,
    /export async function loadPublicXIconMapOptional[\s\S]*?buildRequiredXIdsCacheKey\(requiredXUserIds\)/,
  );
});

test("公開アイコン補完は共有mapからR2 users indexへ降りD1を使わない", () => {
  const iconLoader = source.match(
    /const loadPublicXIconMapOptionalImpl = cache\([\s\S]*?\n\);/,
  )?.[0] ?? "";

  assert.match(iconLoader, /PUBLIC_X_ICON_MAP_OBJECT_KEY/);
  assert.match(iconLoader, /key: "users\/index\.json"/);
  assert.match(iconLoader, /requiredXUserIds/);
  assert.match(iconLoader, /entry\.source === "video"/);
  assert.match(iconLoader, /existing\?\.source === "registered"/);
  assert.match(iconLoader, /existing\?\.source === "none"/);
  assert.match(
    iconLoader,
    /icon_url: user\.icon_url \?\? existing\?\.icon_url \?\? null/,
  );
  assert.match(iconLoader, /source: user\.icon_url \? "registered" : "none"/);
  assert.doesNotMatch(iconLoader, /getDatabase|withDatabase|degradedFetcher|\.prepare\(/);
});

test("動画詳細の作者表示は作品スナップショットのアイコンを使う", () => {
  assert.match(videoPage, /const creatorHref =/);
  assert.match(
    videoPage,
    /creator_has_public_profile[\s\S]*hasProjectedPublicProfile/,
  );
  assert.match(videoPage, /const creatorIcon = video\.creator_icon_url/);
  assert.match(videoPage, /resolveProjectedIcon\([\s\S]*?member\.x_user_id/);
  assert.match(videoPage, /<UserAvatar[\s\S]*?useIconFallback/);
});

test("動画詳細はメンバーを含む必要なX IDをR2アイコンローダーへ渡す", () => {
  assert.match(videoPage, /staticProbe\.data\.publicMembers\.map/);
  assert.match(videoPage, /loadPublicXIconMapOptional\(staticIconXIds\)/);
  assert.match(videoPage, /extraFallbackIconXIds/);
  assert.match(videoPage, /hasProjectedPublicProfile/);
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
