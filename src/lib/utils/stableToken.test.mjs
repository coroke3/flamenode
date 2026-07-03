import test from "node:test";
import assert from "node:assert/strict";
import { buildStableSha256Token } from "./stableToken.ts";

test("buildStableSha256Token is stable across object key order", async () => {
  const a = await buildStableSha256Token({
    table: "events",
    rows: [{ id: "1", title: "A" }],
  });
  const b = await buildStableSha256Token({
    rows: [{ title: "A", id: "1" }],
    table: "events",
  });

  assert.equal(a, b);
});

test("buildStableSha256Token changes when nested values change", async () => {
  const a = await buildStableSha256Token({ rows: [{ id: "1" }] });
  const b = await buildStableSha256Token({ rows: [{ id: "2" }] });

  assert.notEqual(a, b);
});
