import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedR2Json } from "./r2Body.ts";

function bucketWith(object, state = { cancelled: 0, parsed: 0 }) {
  return {
    state,
    bucket: {
      async get() {
        if (object === null) return null;
        return {
          ...object,
          body: {
            cancel() {
              state.cancelled += 1;
            },
          },
          async json() {
            state.parsed += 1;
            if (object.text === undefined) throw new SyntaxError("bad json");
            return JSON.parse(object.text);
          },
        };
      },
    },
  };
}

test("readBoundedR2Jsonは上限内のJSONを返す", async () => {
  const { bucket, state } = bucketWith({ size: 7, text: '{"a":1}' });
  assert.deepEqual(await readBoundedR2Json(bucket, "k", 7), {
    ok: true,
    value: { a: 1 },
  });
  assert.equal(state.cancelled, 0);
});

test("readBoundedR2Jsonはobjectがなければmissingを返す", async () => {
  const { bucket } = bucketWith(null);
  assert.deepEqual(await readBoundedR2Json(bucket, "k", 10), {
    ok: false,
    reason: "missing",
  });
});

test("readBoundedR2Jsonは上限超過・不正sizeをparse前にcancelして拒否する", async () => {
  for (const size of [8, -1, 1.5, Number.NaN]) {
    const { bucket, state } = bucketWith({ size, text: "{}" });
    assert.deepEqual(await readBoundedR2Json(bucket, "k", 7), {
      ok: false,
      reason: "too_large",
    });
    assert.equal(state.cancelled, 1, String(size));
    assert.equal(state.parsed, 0, String(size));
  }
});

test("readBoundedR2Jsonは不正な上限ではbodyを読まない", async () => {
  for (const maxBytes of [0, -1, Number.POSITIVE_INFINITY, 1.5]) {
    const { bucket, state } = bucketWith({ size: 1, text: "{}" });
    const result = await readBoundedR2Json(bucket, "k", maxBytes);
    assert.equal(result.ok, false);
    assert.equal(state.parsed, 0);
  }
});

test("readBoundedR2Jsonはsize不明のobjectを読み、壊れたJSONをinvalid_jsonにする", async () => {
  const known = bucketWith({ text: "[1]" });
  assert.deepEqual(await readBoundedR2Json(known.bucket, "k", 10), {
    ok: true,
    value: [1],
  });
  const broken = bucketWith({ size: 3 });
  const result = await readBoundedR2Json(broken.bucket, "k", 10);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_json");
  assert.ok(result.error instanceof SyntaxError);
});
