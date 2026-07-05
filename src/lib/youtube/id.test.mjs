/**
 * YouTube ID 抽出ロジックの単体テスト。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractYoutubeId,
  youtubeThumbUrl,
  youtubeWatchUrl,
  youtubeEmbedUrl,
} from "./id.ts";

test("extractYoutubeId: 生の 11 桁 ID をそのまま返す", () => {
  assert.equal(extractYoutubeId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractYoutubeId(" dQw4w9WgXcQ "), "dQw4w9WgXcQ");
});

test("extractYoutubeId: null/空/不正は null", () => {
  assert.equal(extractYoutubeId(null), null);
  assert.equal(extractYoutubeId(undefined), null);
  assert.equal(extractYoutubeId(""), null);
  assert.equal(extractYoutubeId("too-short"), null);
  assert.equal(extractYoutubeId("0123456789012"), null); // 13 桁
});

test("extractYoutubeId: youtu.be 短縮 URL", () => {
  assert.equal(
    extractYoutubeId("https://youtu.be/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    extractYoutubeId("https://youtu.be/dQw4w9WgXcQ?t=12"),
    "dQw4w9WgXcQ",
  );
});

test("extractYoutubeId: 通常 watch URL", () => {
  assert.equal(
    extractYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    extractYoutubeId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=42"),
    "dQw4w9WgXcQ",
  );
});

test("extractYoutubeId: shorts / embed / live URL", () => {
  assert.equal(
    extractYoutubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    extractYoutubeId("https://www.youtube.com/embed/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    extractYoutubeId("https://www.youtube.com/live/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
});

test("extractYoutubeId: 別ドメインは null", () => {
  assert.equal(extractYoutubeId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(extractYoutubeId("https://vimeo.com/123456789"), null);
});

test("extractYoutubeId: v= が不正 (短い) なら null", () => {
  assert.equal(
    extractYoutubeId("https://www.youtube.com/watch?v=short"),
    null,
  );
});

test("youtubeThumbUrl: id があれば local cache URL", () => {
  assert.equal(
    youtubeThumbUrl("dQw4w9WgXcQ"),
    "/api/youtube-thumbnail/dQw4w9WgXcQ/hqdefault",
  );
  assert.equal(
    youtubeThumbUrl("dQw4w9WgXcQ", "maxresdefault"),
    "/api/youtube-thumbnail/dQw4w9WgXcQ/maxresdefault",
  );
});

test("youtubeThumbUrl: 空 id は空文字", () => {
  assert.equal(youtubeThumbUrl(null), "");
  assert.equal(youtubeThumbUrl(""), "");
});

test("youtubeWatchUrl: 単純連結", () => {
  assert.equal(
    youtubeWatchUrl("abc"),
    "https://www.youtube.com/watch?v=abc",
  );
});

test("youtubeEmbedUrl: rel/modestbranding/playsinline が常に含まれる", () => {
  const url = youtubeEmbedUrl("abc");
  assert.ok(url.includes("rel=0"));
  assert.ok(url.includes("modestbranding=1"));
  assert.ok(url.includes("playsinline=1"));
  assert.ok(!url.includes("enablejsapi=1"));
});

test("youtubeEmbedUrl: autoplay/mute/start オプション反映", () => {
  const url = youtubeEmbedUrl("abc", { autoplay: true, mute: true, start: 30 });
  assert.ok(url.includes("autoplay=1"));
  assert.ok(url.includes("mute=1"));
  assert.ok(url.includes("start=30"));
});

test("youtubeEmbedUrl: start <= 0 は無視", () => {
  const url = youtubeEmbedUrl("abc", { start: 0 });
  assert.ok(!url.includes("start="));
});
