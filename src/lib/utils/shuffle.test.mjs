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

test("shuffledCopyは不正な乱数でも要素数・値・元配列を保つ", () => {
  const source = ["a", "b", "c", "d"];
  for (const sampled of [-1, 1, 1.5, Number.NaN, Infinity, -Infinity]) {
    const shuffled = shuffledCopy(source, () => sampled);
    assert.equal(shuffled.length, source.length, `sampled=${sampled}`);
    assert.deepEqual([...shuffled].sort(), [...source].sort(), `sampled=${sampled}`);
    assert.deepEqual(source, ["a", "b", "c", "d"]);
  }
});

test("shuffledCopyは正常な乱数と境界値を一貫して扱う", () => {
  assert.deepEqual(shuffledCopy(["a", "b", "c"], () => 0.5), ["a", "c", "b"]);
  assert.deepEqual(shuffledCopy(["a", "b", "c"], () => 1), ["a", "b", "c"]);
  assert.deepEqual(shuffledCopy(["a", "b", "c"], () => Number.NaN), ["b", "c", "a"]);
});
