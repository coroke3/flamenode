import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [
  page,
  route,
  serverOverlay,
  client,
  interaction,
  interactionActions,
  utilityDock,
  aboutPage,
  aboutStatsRoute,
  slotIconRoute,
] = await Promise.all([
  readFile(new URL("../../../app/(public)/[id]/page.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../../../app/api/videos/[id]/viewer-overlay/route.ts", import.meta.url),
    "utf8",
  ),
  readFile(new URL("./videoViewerOverlay.ts", import.meta.url), "utf8"),
  readFile(new URL("./videoViewerOverlayClient.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../components/video/InteractionButton.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../components/video/VideoInteractionActions.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../components/video/VideoViewerUtilityDock.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../../../app/(public)/about/page.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../../../app/api/public/about-stats/route.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../app/api/media/slot-submission-icon/[slotId]/route.ts", import.meta.url),
    "utf8",
  ),
]);

test("公開動画SSRはviewer Auth/D1を実行せずclient overlayへ分離する", () => {
  assert.doesNotMatch(page, /getCurrentUser/);
  assert.doesNotMatch(page, /withDatabase/);
  assert.doesNotMatch(page, /fetchVideoViewerOverlay/);
  assert.doesNotMatch(page, /videoInteractionsAuth/);
  assert.match(page, /VideoInteractionActions/);
  assert.match(page, /VideoViewerUtilityDock/);
});

test("viewer overlay APIはprivate no-storeで404と一時障害を分離する", () => {
  assert.match(route, /loadStaticVideoDetail/);
  assert.match(route, /visibility_status !== "public"/);
  assert.match(route, /"Cache-Control": "private, no-store, no-cache, must-revalidate"/);
  assert.match(route, /detail\.state === "unavailable"/);
  assert.match(route, /status: unavailable \? 503 : 404/);
  assert.match(route, /"Retry-After": "3"/);
  assert.match(route, /loadVideoViewerOverlay/);
});

test("viewer overlay clientは同一requestを共有しRSC refreshを要求しない", () => {
  assert.match(client, /existing\?\.promise/);
  assert.match(client, /cache: "no-store"/);
  assert.match(client, /playlistReady/);
  assert.match(client, /ACTIVE_X_CHANGED_EVENT/);
  assert.doesNotMatch(interaction, /router\.refresh\(\)/);
  assert.doesNotMatch(interaction, /useRouter/);
});

test("video/playlist遷移中は旧viewer overlayを表示・操作しない", () => {
  assert.match(client, /type OverlayState/);
  assert.match(client, /type ResolvedPlaylistState/);
  assert.match(client, /playlistSourceKey/);
  assert.match(client, /playlistState\.sourceKey === sourceKey/);
  assert.match(client, /currentRequestKey/);
  assert.match(client, /overlayIsCurrent/);
  assert.match(client, /overlay: overlayIsCurrent \? overlayState\.value : emptyOverlay\(\)/);
  assert.match(client, /\[videoId, playlist, playlistReady, sourceKey, nonce\]/);
  assert.match(interactionActions, /const canInteract =\s*!loading &&/s);
});

test("重複playlist queryでもutility dockへ配列を流さない", () => {
  assert.match(utilityDock, /function normalizeRuntimePlaylistId\(value: unknown\)/);
  assert.match(utilityDock, /Array\.isArray\(value\)/);
  assert.match(utilityDock, /const safePlaylistId = normalizeRuntimePlaylistId\(playlistId\)/);
  assert.match(utilityDock, /useVideoViewerOverlay\(videoId, safePlaylistId\)/);
  assert.match(utilityDock, /playlistId=\{safePlaylistId\}/);
});

test("viewer overlayはcurrentUserContextのlinked X行を再利用する", () => {
  assert.match(serverOverlay, /context\.linkedXUsers/);
  assert.match(serverOverlay, /entry\.approval_status === "approved"/);
  assert.doesNotMatch(serverOverlay, /getApprovedXIds/);
});

test("viewer chapter編集権限はstatic videoIdとD1解決結果が一致する場合だけ使う", () => {
  assert.match(serverOverlay, /const probe = await fetchVideoRowByIdOrYoutube\(db, args\.rawId\)/);
  assert.match(serverOverlay, /if \(probe\?\.id === args\.videoId\) \{/);
  const idGuard = serverOverlay.indexOf("if (probe?.id === args.videoId)");
  const authCall = serverOverlay.indexOf("viewerCanEditChapters = await canEditVideo", idGuard);
  assert.ok(idGuard >= 0 && authCall > idGuard);
});

test("viewer private chapterはserver query自体を最大件数でboundedにする", () => {
  assert.match(serverOverlay, /VIDEO_VIEWER_OVERLAY_MAX_PRIVATE_CHAPTERS/);
  assert.match(serverOverlay, /async function fetchBoundedPrivateChapters/);
  assert.match(serverOverlay, /\.orderBy\(asc\(videoChapters\.chapter_time\), asc\(videoChapters\.id\)\)\s*\.limit\(VIDEO_VIEWER_OVERLAY_MAX_PRIVATE_CHAPTERS\)/s);
  assert.match(serverOverlay, /eq\(xUsers\.approval_status, "approved"\)/);
  assert.doesNotMatch(serverOverlay, /fetchAuthorizedPrivateVideoChapters/);
});

test("viewer interaction状態はlike/bookmarkだけをtype集約し最大2行にする", () => {
  assert.match(serverOverlay, /inArray\(videoInteractionsAuth\.interaction_type, \["like", "bookmark"\]\)/);
  assert.match(serverOverlay, /\.groupBy\(videoInteractionsAuth\.interaction_type\)\s*\.limit\(2\)/s);
});

test("viewer library playlistはserver query自体を最大件数でboundedにする", () => {
  assert.match(serverOverlay, /EVENT_PLAYLIST_MAX_ITEMS/);
  assert.match(serverOverlay, /\.orderBy\(desc\(videosTable\.scheduled_time\)\)\s*\.limit\(EVENT_PLAYLIST_MAX_ITEMS\)/s);
});

test("BAN viewerはprivate overlay/write UIをfail-closedにする", () => {
  assert.match(serverOverlay, /viewer\.is_banned === 1/);
  assert.match(serverOverlay, /isBanned: true/);
  assert.match(client, /typeof row\.isBanned !== "boolean"/);
  assert.match(interactionActions, /!overlay\.isBanned/);
  assert.match(utilityDock, /!overlay\.isBanned/);
});

test("about本文はstaticでstats APIも小型artifactだけを読む", () => {
  assert.doesNotMatch(aboutPage, /loadStaticTopPage/);
  assert.doesNotMatch(aboutPage, /export const dynamic\s*=\s*["']force-dynamic["']/);
  assert.match(aboutPage, /<AboutStats \/>/);
  assert.match(aboutStatsRoute, /TOP_STATS_OBJECT_KEY/);
  assert.match(aboutStatsRoute, /normalizeTopStatsSection/);
  assert.match(aboutStatsRoute, /MAX_STATS_BYTES = 64 \* 1024/);
  assert.doesNotMatch(aboutStatsRoute, /top\.json/);
  assert.doesNotMatch(aboutStatsRoute, /normalizeStaticTop/);
});

test("public_name slot iconはAuth.jsより先に公開判定する", () => {
  const probeIndex = slotIconRoute.indexOf("probeSlotSubmissionIcon");
  const authIndex = slotIconRoute.indexOf("getCurrentUser()");
  assert.ok(probeIndex >= 0 && authIndex >= 0 && probeIndex < authIndex);
  assert.match(slotIconRoute, /probe\.kind === "public"/);
  assert.match(slotIconRoute, /serveSlotSubmissionIconRow\(env, probe\.row, null\)/);
});
