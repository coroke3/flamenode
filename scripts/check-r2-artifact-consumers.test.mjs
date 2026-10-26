import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkInventory, extractArtifactKeys, matchesInventory,
  normalizeArtifactKey, readInventoryKeys, readInventoryRows, validateInventoryRows,
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
    // Counts are exact: a stale, larger documented count also fails.
    const stale = approved.replace(" | 2 | Pending", " | 3 | Pending");
    assert.deepEqual(checkInventory({ root, files: [file], inventoryText: stale }).unexpected.map((x) => [x.count, x.limit]),
      [[2, 3]]);
    writeFileSync(join(root, file), 'const x = await env.R2.put("another/new.json", payload);');
    const changed = checkInventory({ root, files: [file], inventoryText: approved });
    assert.deepEqual(changed.missing.map((x) => x.key), ["another/new.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runFixture(source, inventoryText) {
  const root = mkdtempSync(join(tmpdir(), "fn-r2-fixture-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/fixture.ts"), source);
    return checkInventory({ root, inventoryText, files: ["src/fixture.ts"] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("T06 R2 key helpers record the key argument; declarations and non-literal keys are handled", () => {
  const src = [
    "async function putJson(env: Env, key: string, body: unknown) {",
    "  await putJsonArtifact(env, key, body, {});",
    "}",
    'await putJson(env, "unlisted/new-projection.json", payload, CACHE);',
    "await putJsonArtifact({ R2: bucket }, \"list/recent.json\", value, {});",
    'const read = await readBoundedR2Json<Top>(env.BUCKET, "top.json", MAX);',
  ].join("\n");
  const hits = extractArtifactKeys(src, "workers/fake.ts");
  assert.deepEqual(hits.map((h) => [h.kind, h.key]), [
    ["putJson", "unlisted/new-projection.json"],
    ["putJsonArtifact", "list/recent.json"],
    ["readBoundedR2Json", "top.json"],
  ]);
  assert.deepEqual(hits.unresolved.map((r) => [r.kind, r.expression]), [["putJsonArtifact", "key"]]);
  const result = runFixture(src, table(["list/recent.json", "top.json"]));
  assert.deepEqual(result.missing.map((h) => h.key), ["unlisted/new-projection.json"]);
});

test("T07 R2 binding aliases and R2Bucket-typed names are scanned; KV aliases are not", () => {
  const src = [
    "const storage = env.BUCKET;",
    'await storage.get("unlisted/reader.json");',
    "function write(target: R2Bucket) { return target.put(\"unlisted/typed.json\", body); }",
    "const kv = env.KV;",
    'await kv.get("kv/not-r2.json");',
  ].join("\n");
  assert.deepEqual(extractArtifactKeys(src, "src/alias.ts").map((h) => h.key),
    ["unlisted/reader.json", "unlisted/typed.json"]);
  assert.deepEqual(runFixture(src, table([])).missing.map((h) => h.key),
    ["unlisted/reader.json", "unlisted/typed.json"]);
});

test("T08 same-name consts with different values are not resolved to the last declaration", () => {
  const src = [
    'function readUnlisted() { const KEY = "unlisted/new.json"; return env.R2.get(KEY); }',
    'function readKnown() { const KEY = "list/recent.json"; return env.R2.get(KEY); }',
  ].join("\n");
  const hits = extractArtifactKeys(src, "src/scoped.ts");
  assert.deepEqual(hits.map((h) => h.key), []);
  assert.deepEqual(hits.unresolved.map((r) => [r.kind, r.expression]),
    [["bucket.get", "KEY"], ["bucket.get", "KEY"]]);
  const result = runFixture(src, table(["list/recent.json"]));
  assert.deepEqual(result.unexpected.map((x) => [x.key, x.count]), [["src/fixture.ts|bucket.get(KEY)", 2]]);
  // Same value in two scopes is still resolved.
  const same = 'function a() { const KEY = "list/recent.json"; return env.R2.get(KEY); }\n' +
    'function b() { const KEY = "list/recent.json"; return env.R2.head(KEY); }';
  assert.deepEqual(extractArtifactKeys(same, "src/same.ts").map((h) => h.key), ["list/recent.json", "list/recent.json"]);
});

test("T09 direct R2 literals are recorded without a slash or known extension", () => {
  const src = [
    'await env.R2.get("private");',
    'await env.BUCKET.put("asset.bin", payload);',
    'await env.R2.head("config");',
    'await env.R2_STORAGE.delete("uuid");',
  ].join("\n");
  assert.deepEqual(runFixture(src, table([])).missing.map((h) => h.key), ["private", "asset.bin", "config", "uuid"]);
});

test("T10 key rows need producer, consumer, target and owner MIG; detached rows are not keys", () => {
  const header = "| Artifact key | Producer | Consumer | Target / retention | Owner MIG |\n| --- | --- | --- | --- | --- |\n";
  const md = header + [
    "| " + tick + "ok.json" + tick + " | p.ts:1 | c.ts:2 | RETAIN | MIG-0649 |",
    "| " + tick + "new/untracked.json" + tick + " |  |  |  |  |",
    "| " + tick + "dash.json" + tick + " | — | c.ts | build | MIG-0627 |",
    "| " + tick + "noowner.json" + tick + " | p.ts | c.ts | build | media |",
    "| " + tick + "short.json" + tick + " | p.ts | c.ts |",
  ].join("\n") + "\n\nparagraph\n\n| " + tick + "detached.json" + tick + " | p | c | t | MIG-0649 |\n";
  const invalid = validateInventoryRows(readInventoryRows(md));
  assert.deepEqual(invalid.map((x) => x.key), ["new/untracked.json", "dash.json", "noowner.json", "short.json"]);
  assert.equal(readInventoryKeys(md).has("detached.json"), false);
  const result = runFixture('await env.R2.get("new/untracked.json");', md);
  assert.equal(result.missing.length, 0);
  assert.deepEqual(result.invalid.map((x) => x.key), ["new/untracked.json", "dash.json", "noowner.json", "short.json"]);
});
