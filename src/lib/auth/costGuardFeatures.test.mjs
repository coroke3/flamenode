import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseWriteFeatureList } from "./writeGuardCore.ts";

const source = await readFile(new URL("./costGuardFeatures.ts", import.meta.url), "utf8");

test("CostGuard feature list accepts an empty or valid string array", () => {
  assert.deepEqual(parseWriteFeatureList(null), { ok: true, features: [] });
  assert.deepEqual(parseWriteFeatureList(""), { ok: true, features: [] });
  assert.deepEqual(parseWriteFeatureList('["edit_video"]'), {
    ok: true,
    features: ["edit_video"],
  });
});

test("CostGuard feature list is fail-closed when malformed", () => {
  assert.deepEqual(parseWriteFeatureList("{invalid"), { ok: false });
  assert.deepEqual(parseWriteFeatureList('{"key":"value"}'), { ok: false });
  assert.deepEqual(parseWriteFeatureList("[123]"), { ok: false });
  assert.deepEqual(
    parseWriteFeatureList(JSON.stringify(Array.from({ length: 101 }, () => "edit_video"))),
    { ok: false },
  );
});

test("missing system settings and invalid mode are fail-closed", () => {
  assert.match(source, /if \(!row\) return \{ blocked: true, reason: "mode" \}/);
  assert.match(source, /if \(!mode\) return \{ blocked: true, reason: "mode" \}/);
});
