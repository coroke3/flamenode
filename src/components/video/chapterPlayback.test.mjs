import assert from "node:assert/strict";
import test from "node:test";
import { findActiveChapterId } from "./chapterPlayback.ts";

const chapters = [
  { id: "a", chapter_time: 0 },
  { id: "b", chapter_time: 30 },
  { id: "c", chapter_time: 90 },
  { id: "d", chapter_time: 120 },
];

test("findActiveChapterId: returns null before the first chapter", () => {
  assert.equal(findActiveChapterId(chapters, -1), null);
});

test("findActiveChapterId: picks the last chapter at or before current time", () => {
  assert.equal(findActiveChapterId(chapters, 0), "a");
  assert.equal(findActiveChapterId(chapters, 29), "a");
  assert.equal(findActiveChapterId(chapters, 30), "b");
  assert.equal(findActiveChapterId(chapters, 89), "b");
  assert.equal(findActiveChapterId(chapters, 120), "d");
  assert.equal(findActiveChapterId(chapters, 999), "d");
});

test("findActiveChapterId: duplicate timestamps keep the later list entry", () => {
  const dupes = [
    { id: "first", chapter_time: 10 },
    { id: "second", chapter_time: 10 },
  ];
  assert.equal(findActiveChapterId(dupes, 10), "second");
});
