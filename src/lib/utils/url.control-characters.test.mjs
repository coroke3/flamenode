import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHttpUrl } from "#utils/url";

test("URL sanitizer rejects embedded WHATWG-stripped control characters", () => {
  for (const input of [
    "https://exa\nmple.com/path",
    "https://exa\rmple.com/path",
    "https://exa\tmple.com/path",
    "https://example.com/a\nb",
    "https://example.com/a\rb",
    "https://example.com/a\tb",
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
