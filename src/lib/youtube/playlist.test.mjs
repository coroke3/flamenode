import assert from "node:assert/strict";
import test from "node:test";
import {
  extractYoutubePlaylistId,
  parsePlaylistSyncInterval,
  parsePlaylistSyncMode,
} from "./playlist.ts";

test("extractYoutubePlaylistId accepts raw IDs and YouTube URLs", () => {
  const id = "PL1234567890abcdefghij";
  assert.equal(extractYoutubePlaylistId(id), id);
  assert.equal(
    extractYoutubePlaylistId(`https://www.youtube.com/playlist?list=${id}`),
    id,
  );
  assert.equal(
    extractYoutubePlaylistId(`https://www.youtube.com/watch?v=abcdefghijk&list=${id}`),
    id,
  );
  assert.equal(
    extractYoutubePlaylistId(`https://youtu.be/abcdefghijk?list=${id}`),
    id,
  );
});

test("extractYoutubePlaylistId rejects missing or malformed IDs", () => {
  assert.equal(extractYoutubePlaylistId(""), null);
  assert.equal(extractYoutubePlaylistId("https://example.com/playlist"), null);
  assert.equal(
    extractYoutubePlaylistId("https://evil-youtube.com/?list=PL1234567890abcdefghij"),
    null,
  );
  assert.equal(
    extractYoutubePlaylistId("https://example.com/?list=PL1234567890abcdefghij"),
    null,
  );
  assert.equal(
    extractYoutubePlaylistId("ftp://youtube.com/?list=PL1234567890abcdefghij"),
    null,
  );
  assert.equal(extractYoutubePlaylistId("bad id"), null);
});

test("playlist sync mode and interval are bounded", () => {
  assert.equal(parsePlaylistSyncMode("append_only"), "append_only");
  assert.equal(parsePlaylistSyncMode("mirror"), "mirror");
  assert.equal(parsePlaylistSyncMode("unknown"), "off");
  assert.equal(parsePlaylistSyncInterval("30"), 60);
  assert.equal(parsePlaylistSyncInterval("720"), 720);
  assert.equal(parsePlaylistSyncInterval("20000"), 10080);
  assert.equal(parsePlaylistSyncInterval("invalid"), 720);
});
