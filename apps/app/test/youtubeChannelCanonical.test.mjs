import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeYoutubeChannelUrl,
  normalizeYoutubeChannelInput,
} from "../.test-dist/apps/app/src/lib/youtubeChannel.js";

test("MIG-0712: canonical YouTube handles and channel paths preserve CURRENT output", () => {
  assert.equal(normalizeYoutubeChannelUrl("https://m.youtube.com/@creator/videos?view=1"),
    "https://www.youtube.com/@creator");
  assert.equal(normalizeYoutubeChannelUrl("http://youtube.com/channel/UCtest123/videos"),
    "https://www.youtube.com/channel/UCtest123");
  assert.equal(normalizeYoutubeChannelUrl("https://www.youtube.com/c/custom/videos"),
    "https://www.youtube.com/c/custom");
  assert.equal(normalizeYoutubeChannelUrl("https://www.youtube.com/user/legacy"),
    "https://www.youtube.com/user/legacy");
});

test("MIG-0712: bare @ and empty channel IDs are not canonical channel links", () => {
  for (const url of [
    "https://youtube.com/@",
    "https://www.youtube.com/@/videos",
    "https://m.youtube.com/@?tab=videos",
    "https://youtube.com/channel/",
    "https://youtube.com/user/",
  ]) {
    assert.equal(normalizeYoutubeChannelUrl(url), null, url);
  }
  assert.equal(normalizeYoutubeChannelInput("https://youtube.com/@"), "https://youtube.com/@");
});

test("MIG-0712: final canonical URL must fit within 500 characters", () => {
  const prefix = "http://youtube.com/@";
  const canonicalPrefix = "https://www.youtube.com/@";
  const maxHandle = "x".repeat(500 - canonicalPrefix.length);
  const tooLongHandle = maxHandle + "x";
  assert.ok((prefix + tooLongHandle).length <= 500);
  assert.equal(normalizeYoutubeChannelUrl(prefix + maxHandle), canonicalPrefix + maxHandle);
  assert.equal(normalizeYoutubeChannelUrl(prefix + tooLongHandle), null);
  assert.equal(normalizeYoutubeChannelInput(prefix + tooLongHandle), prefix + tooLongHandle);
  const channelPrefix = "http://youtube.com/channel/";
  const longChannel = "c".repeat(501 - "https://www.youtube.com/channel/".length);
  assert.ok((channelPrefix + longChannel).length <= 500);
  assert.equal(normalizeYoutubeChannelUrl(channelPrefix + longChannel), null);
});
