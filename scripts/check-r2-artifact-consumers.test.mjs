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
