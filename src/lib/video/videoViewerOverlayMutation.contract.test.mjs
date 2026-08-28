import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [client, interaction] = await Promise.all([
  readFile(new URL("./videoViewerOverlayClient.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../components/video/InteractionButton.tsx", import.meta.url),
    "utf8",
  ),
]);

test("interaction成功後はfull RSCではなくviewer overlay update eventを通知する", () => {
  assert.doesNotMatch(interaction, /router\.refresh\(\)/);
  assert.match(interaction, /notifyVideoViewerOverlayChanged\(videoId\)/);
});

test("mount済みviewer overlay hookはmutation eventを受けてcacheを破棄する", () => {
  assert.match(client, /VIDEO_VIEWER_OVERLAY_CHANGED_EVENT/);
  assert.match(client, /invalidateVideoViewerOverlay\(videoId\)/);
  assert.match(client, /setNonce\(\(value\) => value \+ 1\)/);
  assert.match(client, /if \(existing\?\.promise\) return existing\.promise/);
});

test("invalidate前の遅いrequestは新しいviewer cacheを上書きしない", () => {
  assert.match(client, /requestToken: symbol/);
  assert.match(client, /const requestToken = Symbol\(key\)/);
  assert.match(
    client,
    /cache\.get\(key\)\?\.requestToken === requestToken/,
  );
  assert.match(client, /cache\.set\(key, \{ promise, requestToken \}\)/);
});

test("viewer overlayのnon-OK responseは未ログイン扱いにせずfail-closedにする", () => {
  assert.match(client, /if \(!response\.ok\) return emptyOverlay\(true\)/);
});

test("interactionは二重送信とserver action rejectから復旧する", () => {
  assert.match(interaction, /actionInFlightRef = React\.useRef\(false\)/);
  assert.match(
    interaction,
    /if \(actionInFlightRef\.current \|\| busy \|\| !canInteract\) return/,
  );
  assert.match(interaction, /catch \(writeError\)/);
  assert.match(interaction, /setActive\(previousActive\)/);
  assert.match(interaction, /setDisplayCount\(previousCount\)/);
  assert.match(interaction, /finally \{/);
  assert.match(interaction, /actionInFlightRef\.current = false/);
});
