import assert from "node:assert/strict";
import test from "node:test";
import { normalizeYoutubeChannelUrl, normalizeYoutubeChannelInput } from "./youtubeChannel.ts";

test("YouTube channel URLs retain canonical handles and channel paths", () => {
  assert.equal(normalizeYoutubeChannelUrl("https://m.youtube.com/@creator/videos?view=1"),
    "https://www.youtube.com/@creator");
  assert.equal(normalizeYoutubeChannelUrl("http://youtube.com/channel/UCtest123/videos"),
    "https://www.youtube.com/channel/UCtest123");
  assert.equal(normalizeYoutubeChannelUrl("https://www.youtube.com/c/custom/videos"),
    "https://www.youtube.com/c/custom");
  assert.equal(normalizeYoutubeChannelUrl("https://www.youtube.com/user/legacy"),
    "https://www.youtube.com/user/legacy");
});

test("bare @ and missing channel IDs do not become canonical channel URLs", () => {
  for (const url of [
    "https://youtube.com/@",
    "https://www.youtube.com/@/videos",
    "https://m.youtube.com/@?tab=videos",
    "https://youtube.com/channel/",
    "https://youtube.com/user/",
  ]) {
    assert.equal(normalizeYoutubeChannelUrl(url), null, url);
  }
  // Input storage intentionally still allows other well-formed HTTP(S) URLs.
  assert.equal(normalizeYoutubeChannelInput("https://youtube.com/@"), "https://youtube.com/@");
});

test("canonicalization never exceeds the 500-character URL bound", () => {
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
