import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowChapterAuthor } from "./chapterPresentation.ts";

test("member chapter does not repeat the same display name as its author", () => {
  assert.equal(shouldShowChapterAuthor("Mochi", "Mochi"), false);
  assert.equal(shouldShowChapterAuthor("@Mochi", "mochi"), false);
  assert.equal(shouldShowChapterAuthor("Ｍｏｃｈｉ", "Mochi"), false);
});

test("chapter author stays visible when the label describes a different chapter", () => {
  assert.equal(shouldShowChapterAuthor("Opening", "Mochi"), true);
  assert.equal(shouldShowChapterAuthor("Opening", null), false);
});
