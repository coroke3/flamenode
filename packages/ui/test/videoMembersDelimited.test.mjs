// MIG-0713 U01: CSV/TSV parser is pure, bounded and faithful to CURRENT.
import assert from "node:assert/strict";
import test from "node:test";
import { stripBom, parseDelimited, serializeDelimited, detectDelimiter } from "../dist/forms/videoMembers/delimited.js";

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

test("detectDelimiter: quoted separators must not change the CSV/TSV type", () => {
  const csv = '\uFEFF\n"Research\tOps\tQA",name\n"Team\tA",Alice';
  assert.equal(detectDelimiter(csv), ",");
  assert.deepEqual(parseDelimited(csv, detectDelimiter(csv)), [
    ["Research\tOps\tQA", "name"], ["Team\tA", "Alice"],
  ]);

  const tsv = '"Staff,Event,Operations"\tname\n"Admin,Owner"\tBob';
  assert.equal(detectDelimiter(tsv), "\t");
  assert.deepEqual(parseDelimited(tsv, detectDelimiter(tsv)), [
    ["Staff,Event,Operations", "name"], ["Admin,Owner", "Bob"],
  ]);
});

test("detectDelimiter: multiline fields and escaped quotes stay inside the first record", () => {
  const csv = '"line 1\nline\t2\t3 ""comma,inside""",name\nvalue,Alice';
  assert.equal(detectDelimiter(csv), ",");
  assert.deepEqual(parseDelimited(csv, detectDelimiter(csv)), [
    ['line 1\nline\t2\t3 "comma,inside"', "name"], ["value", "Alice"],
  ]);
  assert.equal(detectDelimiter("\n \nname,role\nBob,admin"), ",");
  assert.equal(detectDelimiter("\n \nname\trole\nBob\tadmin"), "\t");
});

for (const delimiter of [",", "\t"]) {
  test("MIG-0730: CURRENT CR/LF/CRLF member records and bounded quoted cells " + JSON.stringify(delimiter), () => {
    const expected = [["name", "notes"], ["Alice", "line\rinside"], ["Bob", 'say "yes"']];
    const records = [
      expected[0].join(delimiter),
      ["Alice", '"line\rinside"'].join(delimiter),
      ["Bob", '"say ""yes"""'].join(delimiter),
    ];
    for (const separator of ["\r", "\n", "\r\n"]) {
      const text = "\uFEFF" + records.join(separator) + separator;
      assert.equal(detectDelimiter(text), delimiter);
      assert.deepEqual(parseDelimited(text, delimiter), expected);
      for (const maxRows of [0, 1, 2, 3, 4]) {
        assert.deepEqual(parseDelimited(text, delimiter, { maxRows }), expected.slice(0, maxRows));
      }
      assert.deepEqual(parseDelimited(serializeDelimited(expected, delimiter), delimiter), expected);
    }
    const mixed = records[0] + "\r" + records[1] + "\r\n" + records[2] + "\n";
    assert.deepEqual(parseDelimited(mixed, delimiter), expected);
  });
}
