import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHttpUrl } from "#utils/url";

test("URL sanitizer rejects embedded WHATWG-stripped control characters", () => {
  for (const input of [
    "\nhttps://example.com/path",
    "https://example.com/path\n",
    "\rhttps://example.com/path",
    "https://example.com/path\r",
    "\thttps://example.com/path",
    "https://example.com/path\t",
    "https://exa\nmple.com/path",
    "https://exa\rmple.com/path",
    "https://exa\tmple.com/path",
    "https://example.com/a\nb",
    "https://example.com/a\rb",
    "https://example.com/a\tb",
    "https://example.com\\@evil.com",
    "https://example.com/a\\b",
    "https:\\example.com",
  ]) {
    assert.equal(normalizeHttpUrl(input), null, JSON.stringify(input));
  }
});

test("URL sanitizer preserves legitimate trimmed HTTP URLs", () => {
  assert.equal(normalizeHttpUrl(" https://example.com/path "), "https://example.com/path");
  assert.equal(normalizeHttpUrl("http://example.com"), "http://example.com/");
  assert.equal(normalizeHttpUrl("javascript:alert(1)"), null);
  assert.equal(normalizeHttpUrl("https://user:pass@example.com"), null);
  assert.equal(normalizeHttpUrl("https://example.com", { maxLength: 8 }), null);
});

test("URL sanitizer never disables maxLength for invalid numeric limits", () => {
  for (const maxLength of [NaN, Infinity, -Infinity, -1, 0.5]) {
    assert.equal(normalizeHttpUrl("https://example.com/", { maxLength }), null, String(maxLength));
  }
  assert.equal(normalizeHttpUrl("https://example.com/", { maxLength: 20 }), "https://example.com/");
});
