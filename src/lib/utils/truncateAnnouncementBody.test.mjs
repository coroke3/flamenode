import assert from "node:assert/strict";
import { test } from "node:test";
import { truncateAnnouncementBody } from "./truncateAnnouncementBody.ts";

test("CURRENT announcement excerpt keeps the 179-code-unit prefix and three-dot suffix", () => {
  assert.equal(truncateAnnouncementBody("a".repeat(180)), "a".repeat(180));
  assert.equal(truncateAnnouncementBody("a".repeat(181)), "a".repeat(179) + "...");
  assert.equal(truncateAnnouncementBody("a".repeat(200)).length, 182);
});

test("truncation never emits a lone high surrogate at the emoji boundary", () => {
  const cutInsidePair = "a".repeat(178) + "😀" + "x".repeat(4);
  const excerpt = truncateAnnouncementBody(cutInsidePair);
  assert.equal(excerpt, "a".repeat(178) + "...");
  assert.equal(new TextEncoder().encode(excerpt).includes(0xef), false, "no U+FFFD replacement byte");

  const cutAfterPair = "a".repeat(177) + "😀" + "x".repeat(4);
  assert.equal(truncateAnnouncementBody(cutAfterPair), "a".repeat(177) + "😀...");
  assert.equal(truncateAnnouncementBody("あ".repeat(178) + "🎿" + "x".repeat(8)), "あ".repeat(178) + "...");
});

test("short and exactly-180-code-unit announcements remain unchanged", () => {
  for (const body of ["", "通知", "😀", "😀".repeat(90), "あ".repeat(179) + "x"]) {
    assert.equal(truncateAnnouncementBody(body), body);
  }
});
