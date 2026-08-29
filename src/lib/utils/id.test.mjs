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

test("generateId: Web Crypto fallback uses getRandomValues", () => {
  const originalCrypto = globalThis.crypto;
  let calls = 0;
  const fallbackCrypto = {
    getRandomValues(bytes) {
      calls += 1;
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = index;
      }
      return bytes;
    },
  };

  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: fallbackCrypto,
  });
  try {
    const id = generateId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(calls, 1);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});
