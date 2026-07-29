import assert from "node:assert/strict";
import { test } from "node:test";

import { shuffledCopy } from "./shuffle.ts";

test("shuffledCopyは元配列を変更せず全要素を並べ替える", () => {
  const source = ["a", "b", "c", "d"];
  const shuffled = shuffledCopy(source, () => 0);

  assert.deepEqual(source, ["a", "b", "c", "d"]);
  assert.deepEqual(shuffled, ["b", "c", "d", "a"]);
  assert.notEqual(shuffled, source);
});

test("shuffledCopyは空配列と1要素でも新しい配列を返す", () => {
  const empty = [];
  const single = ["only"];

  assert.deepEqual(shuffledCopy(empty), []);
  assert.deepEqual(shuffledCopy(single), ["only"]);
  assert.notEqual(shuffledCopy(single), single);
});
