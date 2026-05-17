import { test } from "node:test";
import assert from "node:assert/strict";
import { generateId, shortId } from "./id.ts";

test("generateId: prefix なしは UUID 形式", () => {
  const id = generateId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("generateId: prefix ありは prefix_ で始まる", () => {
  const id = generateId("vid");
  assert.match(id, /^vid_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("generateId: 100 件生成して重複しない", () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(generateId());
  assert.equal(seen.size, 100);
});

test("shortId: デフォルト 10 文字", () => {
  const s = shortId();
  assert.equal(s.length, 10);
  assert.match(s, /^[abcdefghjkmnpqrstuvwxyz23456789]+$/);
});

test("shortId: 指定長さ", () => {
  assert.equal(shortId(5).length, 5);
  assert.equal(shortId(20).length, 20);
});

test("shortId: 紛らわしい文字 (0/1/i/l/o) を含まない", () => {
  for (let i = 0; i < 50; i++) {
    const s = shortId(20);
    assert.equal(/[01iIlLoO]/.test(s), false, `紛らわしい文字: ${s}`);
  }
});
