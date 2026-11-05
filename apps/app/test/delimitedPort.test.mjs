// MIG-0713 U01: CSV/TSV parser is pure, bounded and faithful to CURRENT.
import assert from "node:assert/strict";
import test from "node:test";
import { stripBom, parseDelimited, serializeDelimited, detectDelimiter } from "../.test-dist/apps/app/src/lib/delimited.js";

test("MIG-0713: UTF-8 BOM and quoted CSV cells preserve commas/newlines and escaped quotes", () => {
  const csv = '\uFEFFname,notes\n"Alice, A.","hello\nworld"\nBob,"said ""yes"""';
  assert.deepEqual(parseDelimited(csv), [
    ["name", "notes"],
    ["Alice, A.", "hello\nworld"],
    ["Bob", 'said "yes"'],
  ]);
  assert.equal(stripBom("\uFEFFtest"), "test");
});

test("MIG-0713: TSV autodetection and roundtrip preserve member fields", () => {
  const rows = [["name", "x_user_id", "role"], ["Alice", "@alice", "editor"], ["Bob", "@bob", "review"]];
  const serialized = serializeDelimited(rows, "\t");
  assert.equal(detectDelimiter(serialized), "\t");
  assert.deepEqual(parseDelimited(serialized, "\t"), rows);
  assert.equal(detectDelimiter("name,role\nBob,review"), ",");
});

test("MIG-0713: maxRows bounds parsing without reading unbounded members", () => {
  assert.deepEqual(parseDelimited("name,role\nAlice,owner\nBob,guest", ",", { maxRows: 2 }), [
    ["name", "role"], ["Alice", "owner"]
  ]);
  assert.deepEqual(parseDelimited("name,role", ",", { maxRows: 0 }), []);
  assert.deepEqual(parseDelimited("name,role\nAlice,owner", ",", { maxRows: -1 }), []);
});

test("MIG-0713: serialized quoted TSV roundtrips unicode and newlines", () => {
  const rows = [["ひらがな", 'Alice\t"staff"'], ["@xid", "2行\n内容"]];
  assert.deepEqual(parseDelimited(serializeDelimited(rows, "\t"), "\t"), rows);
});
