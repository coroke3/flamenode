import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLegacyVideoCursor } from "./legacyCursor.ts";

test("旧cursorのlast_video_idを従来どおりtrimして返す", () => {
  assert.equal(
    normalizeLegacyVideoCursor('{"last_video_id":"  video-10  "}'),
    "video-10",
  );
});

test("旧cursorの欠落・型不正・JSON不正は空文字へ戻す", () => {
  assert.equal(normalizeLegacyVideoCursor(null), "");
  assert.equal(normalizeLegacyVideoCursor(""), "");
  assert.equal(normalizeLegacyVideoCursor("{}"), "");
  assert.equal(normalizeLegacyVideoCursor('{"last_video_id":10}'), "");
  assert.equal(normalizeLegacyVideoCursor("{invalid"), "");
});
