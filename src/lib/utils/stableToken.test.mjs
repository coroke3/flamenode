import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("stable SHA256 uses code-unit property order, not locale-dependent collation", async () => {
  const value = {
    "ä": "umlaut",
    z: "lower-z",
    a: "lower-a",
    Z: "upper-Z",
  };
  const canonical = '{"Z":"upper-Z","a":"lower-a","z":"lower-z","ä":"umlaut"}';
  const expected = createHash("sha256").update(canonical, "utf8").digest("hex");
  assert.equal(await buildStableSha256Token(value), expected);
  assert.equal(await buildStableSha256Token({ Z: "upper-Z", a: "lower-a", z: "lower-z", "ä": "umlaut" }), expected);
});

test("stable SHA256 canonicalizes nested row keys independent of insertion order", async () => {
  const payload = {
    table: "events",
    rows: [{ "β": "beta", a: "lower", Z: "upper" }],
  };
  const canonical = '{"rows":[{"Z":"upper","a":"lower","β":"beta"}],"table":"events"}';
  const expected = createHash("sha256").update(canonical, "utf8").digest("hex");
  assert.equal(await buildStableSha256Token(payload), expected);
  assert.equal(
    await buildStableSha256Token({ rows: [{ Z: "upper", "β": "beta", a: "lower" }], table: "events" }),
    expected,
  );
});
