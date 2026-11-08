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

test("shuffledCopyは範囲外・非有限の乱数でも配列の長さと要素を保持する", () => {
  const source = ["a", "b", "c", "d"];
  for (const sample of [-1, -0.1, 1, 1.25, NaN, Infinity, -Infinity]) {
    const actual = shuffledCopy(source, () => sample);
    assert.equal(actual.length, source.length, String(sample));
    assert.deepEqual([...actual].sort(), [...source].sort(), String(sample));
    assert.ok(actual.every((item) => typeof item === "string"), String(sample));
  }
  assert.deepEqual(source, ["a", "b", "c", "d"]);
});

test("shuffledCopyは正常な小数乱数の既存Fisher-Yates結果を維持する", () => {
  const source = ["a", "b", "c", "d"];
  assert.deepEqual(shuffledCopy(source, () => 0.5), ["a", "d", "b", "c"]);
});
