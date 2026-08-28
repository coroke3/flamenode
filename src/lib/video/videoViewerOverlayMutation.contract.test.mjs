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
