import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const playerSource = await readFile(
  new URL("./YoutubePlayer.tsx", import.meta.url),
  "utf8",
);

test("YoutubePlayer: ready 前の seek をキューし、ready 後に flush する", () => {
  assert.match(playerSource, /readyRef/);
  assert.match(playerSource, /pendingSeekRef/);
  assert.match(
    playerSource,
    /if \(readyRef\.current\) \{[\s\S]*?seekYoutubeIframe/,
  );
  assert.match(
    playerSource,
    /pendingSeekRef\.current = time/,
  );
  assert.match(
    playerSource,
    /flushPendingSeek/,
  );
  assert.match(
    playerSource,
    /parsed\.kind === "ready"[\s\S]*?flushPendingSeek/,
  );
});

test("YoutubePlayer: iframe id・eager load・ready 後ポーリングを使う", () => {
  assert.match(playerSource, /id=\{YOUTUBE_PLAYER_IFRAME_ID\}/);
  assert.match(playerSource, /loading="eager"/);
  assert.doesNotMatch(playerSource, /loading="lazy"/);
  assert.match(
    playerSource,
    /readyRef\.current = true[\s\S]*?setInterval\(poll, 500\)/,
  );
  assert.match(
    playerSource,
    /onVisibilityChange[\s\S]*?startYoutubePlayerListening[\s\S]*?requestYoutubeCurrentTime/,
  );
});
