import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkInventory, extractArtifactKeys, matchesInventory,
  normalizeArtifactKey, readInventoryKeys,
} from "./check-r2-artifact-consumers.mjs";

const tick = String.fromCharCode(96);
const interp = String.fromCharCode(36, 123);
const table = (keys) => [
  "| Artifact key | Producer | Consumer | Target | MIG |",
  "| --- | --- | --- | --- | --- |",
  ...keys.map((key) => "| " + tick + key + tick + " | producer | reader | build | MIG-0649 |"),
].join("\n");

test("T01 known source literals are listed and non-R2 Map/KV.get is ignored", () => {
  const src = [
    'const x = { r2Key: "list/recent.json" };',
    'const y = await env.BUCKET.get("events/index.json");',
    'const u = await env.KV.get("private/session-token");',
    'const d = await new Map().get("private/session-token");',
    'export const TOP_STATS_OBJECT_KEY = "top/sections/stats.v1.json";',
  ].join("\n");
  const got = extractArtifactKeys(src, "src/fake.ts");
  assert.deepEqual(got.map((h) => h.key), [
    "list/recent.json", "events/index.json", "top/sections/stats.v1.json",
  ]);
  const documented = readInventoryKeys(table(got.map((h) => h.key)));
  assert.equal(got.every((h) => matchesInventory(h.key, documented)), true);
  assert.equal(got[1].line, 2);
});

test("T02 unknown R2 key fails with source path and line", () => {
  const root = mkdtempSync(join(tmpdir(), "fn-r2-inventory-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/newReader.ts"), [
      "// fixture reader",
      'const key = { r2Key: "foo/bar.json" };',
    ].join("\n"));
    const result = checkInventory({
      root,
      inventoryText: table(["list/recent.json"]),
      files: ["src/newReader.ts"],
    });
    assert.deepEqual(result.missing.map((h) => [h.path, h.line, h.key]),
      [["src/newReader.ts", 2, "foo/bar.json"]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("T03 template R2 key interpolation becomes documented <id> shape", () => {
  const expr = tick + "events/" + interp + "id}/release.v1.json" + tick;
  const rows = extractArtifactKeys("const x = { r2Key: " + expr + " };", "src/page.ts");
  assert.deepEqual(rows.map((h) => h.key), ["events/<id>/release.v1.json"]);
  assert.equal(normalizeArtifactKey("events/" + interp + "eventId}/release.v1.json"), "events/<id>/release.v1.json");
  const known = readInventoryKeys(table(["events/<id>/release.v1.json"]));
  assert.equal(matchesInventory(rows[0].key, known), true);
  assert.equal(matchesInventory("events/spring/release.v1.json", known), true);
  assert.equal(matchesInventory("events/spring/other/release.v1.json", known), false);
});

test("multiline expressions, same key across sources, and R2 constants are found", () => {
  const src = [
    "const args = {",
    "  r2Key:",
    '  "rules/current.json",',
    "};",
    'export const GA4_RECENT_LIST_KEY = "list/recent.json";',
    'const blob = await bucket.get("rules/current.json");',
  ].join("\n");
  const got = extractArtifactKeys(src, "workers/fake.mjs");
  assert.deepEqual(got.map((x) => x.key).sort(),
    ["rules/current.json", "rules/current.json", "list/recent.json"].sort());
});


test("T04 R2 put, head, delete, local named constants and imported dynamic keys are audited", () => {
  const src = [
    'const NEW_KEY = "new/unlisted.json";',
    'const x = await env.R2.get(NEW_KEY);',
    'await env.R2.put("new/producer.json", payload);',
    'await env.BUCKET.head("new/probe.json");',
    'await env.R2_STORAGE.delete("new/removed.json");',
    'const y = await env.R2.get(IMPORTED_KEY);',
    'const z = await env.KV.get("kv/private.json");',
  ].join("\n");
  const hits = extractArtifactKeys(src, "src/key-ops.ts");
  const keys = hits.map((row) => row.key).sort();
  assert.deepEqual(keys, [
    "new/unlisted.json", "new/producer.json", "new/probe.json", "new/removed.json",
  ].sort());
  assert.deepEqual(hits.unresolved.map((row) => [row.kind, row.expression]),
    [["bucket.get", "IMPORTED_KEY"]]);
  assert.equal(hits.find((row) => row.key === "new/unlisted.json")?.line, 2);
  assert.equal(hits.find((row) => row.key === "new/producer.json")?.kind, "bucket.put");
});

test("T05 unresolved R2 references fail unless individually documented, and counts are capped", () => {
  const root = mkdtempSync(join(tmpdir(), "fn-r2-dynamic-"));
  try {
    mkdirSync(join(root, "src"));
    const file = "src/reader.ts";
    writeFileSync(join(root, file), [
      "const a = await env.R2.get(IMPORTED_KEY);",
      "const b = await env.R2.get(IMPORTED_KEY);",
    ].join("\n"));
    const initial = checkInventory({ root, files: [file], inventoryText: table([]) });
    assert.deepEqual(initial.missing, []);
    assert.deepEqual(initial.unexpected.map((x) => [x.key, x.count, x.limit]),
      [["src/reader.ts|bucket.get(IMPORTED_KEY)", 2, 0]]);
    const approved = table([]) + [
      "",
      "## Reviewed dynamic R2 calls",
      "| File | Method/expression | Maximum call sites | Review |",
      "| --- | --- | --- | --- |",
      "| " + tick + file + tick + " | " + tick + "bucket.get(IMPORTED_KEY)" + tick + " | 2 | Pending MIG-0627 |",
    ].join("\n");
    const checked = checkInventory({ root, files: [file], inventoryText: approved });
    assert.deepEqual(checked.unexpected, []);
    const reduced = approved.replace(" | 2 | Pending", " | 1 | Pending");
    assert.equal(checkInventory({ root, files: [file], inventoryText: reduced }).unexpected.length, 1);
    writeFileSync(join(root, file), 'const x = await env.R2.put("another/new.json", payload);');
    const changed = checkInventory({ root, files: [file], inventoryText: approved });
    assert.deepEqual(changed.missing.map((x) => x.key), ["another/new.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
