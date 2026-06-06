import { test } from "node:test";
import assert from "node:assert/strict";
import { generateId } from "./id.ts";

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
