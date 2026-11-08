import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("../../../scripts/ts-path-alias-loader.mjs", import.meta.url);

const { looksLikeMojibake } = await import("./mojibake.ts");
const { compactText, SITE_DESCRIPTION, buildPageMetadata } = await import("../seo.ts");
const { buildPageHead, DEFAULT_SITE_DESCRIPTION } = await import("../../../apps/site/src/lib/pageHead.ts");

test("DEL and C1 control codes are detected as unreadable metadata", () => {
  for (const codePoint of [0x7f, 0x80, 0x85, 0x9f]) {
    const text = `説明${String.fromCharCode(codePoint)}テキスト`;
    assert.equal(looksLikeMojibake(text), true, codePoint.toString(16));
  }
});

test("existing C0 control detection and readable whitespace are preserved", () => {
  for (const codePoint of [0x00, 0x08, 0x0b, 0x1f]) {
    assert.equal(looksLikeMojibake(`a${String.fromCharCode(codePoint)}b`), true);
  }
  assert.equal(looksLikeMojibake("普通の説明文\n改行\t絵文字🚀"), false);
});

test("CURRENT SEO title and description fail closed for C1 and DEL characters", () => {
  for (const codePoint of [0x7f, 0x85, 0x9f]) {
    const contaminated = `公開${String.fromCharCode(codePoint)}イベント`;
    assert.equal(compactText(contaminated), SITE_DESCRIPTION);
    const metadata = buildPageMetadata({ title: contaminated, description: contaminated, path: "/about" });
    assert.equal(metadata.title, "FlameNodeについて");
    assert.equal(metadata.description, SITE_DESCRIPTION);
  }
});

test("Astro pageHead metadata uses the same unreadable-text fallback", () => {
  for (const codePoint of [0x7f, 0x85, 0x9f]) {
    const contaminated = `公開${String.fromCharCode(codePoint)}イベント`;
    const head = buildPageHead({ path: "/about", title: contaminated, description: contaminated });
    assert.equal(head.ogTitle, "FlameNodeについて");
    assert.equal(head.description, DEFAULT_SITE_DESCRIPTION);
  }
});
