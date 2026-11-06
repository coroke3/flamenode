import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHttpUrl, safeDecodeURIComponent } from "./url.ts";
import { normalizeHttpUrl as normalizeSpaHttpUrl } from "../../../apps/app/src/lib/url.ts";
import { normalizeHttpUrl as normalizeOpsHttpUrl } from "../../../apps/ops/src/components/shared/url.ts";
import { normalizeYoutubeChannelInput } from "../../../apps/api/src/routes/personal/candidates.ts";

test("null/空文字は null を返す", () => {
  assert.equal(normalizeHttpUrl(null), null);
  assert.equal(normalizeHttpUrl(undefined), null);
  assert.equal(normalizeHttpUrl(""), null);
  assert.equal(normalizeHttpUrl("   "), null);
});

test("有効な http/https URL は正規化して返す", () => {
  assert.equal(normalizeHttpUrl("https://example.com"), "https://example.com/");
  assert.equal(normalizeHttpUrl("http://example.com/foo/bar?a=1"), "http://example.com/foo/bar?a=1");
});

test("無効なプロトコルは null を返す", () => {
  assert.equal(normalizeHttpUrl("javascript:alert(1)"), null);
  assert.equal(normalizeHttpUrl("data:text/html,evil"), null);
  assert.equal(normalizeHttpUrl("ftp://example.com"), null);
});

test("不正な URL 形式は null を返す", () => {
  assert.equal(normalizeHttpUrl("not-a-url"), null);
  assert.equal(normalizeHttpUrl("http://"), null);
});

test("文字数上限オーバーは null を返す", () => {
  assert.equal(normalizeHttpUrl("https://example.com", { maxLength: 10 }), null);
});

test("credentials embedded in public URLs are rejected in CURRENT and SPA", () => {
  for (const normalize of [normalizeHttpUrl, normalizeSpaHttpUrl, normalizeOpsHttpUrl]) {
    assert.equal(normalize("https://user:secret@example.com/path"), null);
    assert.equal(normalize("https://user@example.com/"), null);
    assert.equal(normalize("https://:secret@example.com/"), null);
    assert.equal(normalize("https://user%40name:password@example.com/"), null);
    assert.equal(normalize("https://example.com/path"), "https://example.com/path");
    assert.equal(normalize("http://example.com/"), "http://example.com/");
  }
});

test("Hono candidate URL normalization also rejects embedded credentials", () => {
  assert.equal(normalizeYoutubeChannelInput("https://user:secret@example.com/path"), null);
  assert.equal(normalizeYoutubeChannelInput("https://user:secret@youtube.com/@creator"), null);
  assert.equal(normalizeYoutubeChannelInput("https://www.youtube.com/@creator"), "https://www.youtube.com/@creator");
  assert.equal(normalizeYoutubeChannelInput("https://example.com/path"), "https://example.com/path");
});

test("safeDecodeURIComponent returns null for malformed escapes", () => {
  assert.equal(safeDecodeURIComponent("event%20id"), "event id");
  assert.equal(safeDecodeURIComponent("broken%"), null);
});

test("normalizeHttpUrl caps the serialized URL, not only the raw character count", () => {
  const shortRaw = `https://example.com/${"雪".repeat(55)}`;
  assert.ok(shortRaw.length < 500);
  assert.ok(new URL(shortRaw).toString().length > 500);
  assert.equal(normalizeHttpUrl(shortRaw), null);

  const unicode = "https://example.com/雪";
  const encoded = new URL(unicode).toString();
  assert.equal(normalizeHttpUrl(unicode, { maxLength: encoded.length - 1 }), null);
  assert.equal(normalizeHttpUrl(unicode, { maxLength: encoded.length }), encoded);

  const noSlash = "https://example.com";
  assert.equal(normalizeHttpUrl(noSlash, { maxLength: noSlash.length }), null);
  assert.equal(normalizeHttpUrl(noSlash), "https://example.com/");
});
