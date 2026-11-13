import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  SPREADSHEET_AUDIT_PK_V1_CONTEXT,
  SPREADSHEET_AUDIT_PK_V1_PREFIX,
  buildSpreadsheetAuditIdentityV1,
  buildSpreadsheetAuditHistoryLookup,
  classifySpreadsheetAuditHistoryCandidate,
  parseSpreadsheetAuditIdentityV1,
} from "../src/routes/admin/spreadsheet/auditTargetId.ts";
import {
  spreadsheetRecordIdFromPk,
} from "../src/routes/admin/spreadsheet/writeValidation.ts";

// This is a FUTURE, unmounted identity contract. CURRENT and MIG-0638 writers
// still store the legacy "admin_spreadsheet" / colon-joined target_id.

test("Issue #674: v1 disambiguates two distinct same-table colon-joined PKs", () => {
  const first = { left: "x:y", right: "z" };
  const second = { left: "x", right: "y:z" };
  assert.equal(spreadsheetRecordIdFromPk(first), "x:y:z");
  assert.equal(spreadsheetRecordIdFromPk(second), "x:y:z");
  const a = buildSpreadsheetAuditIdentityV1(first);
  const b = buildSpreadsheetAuditIdentityV1(second);
  assert.equal(a.context, SPREADSHEET_AUDIT_PK_V1_CONTEXT);
  assert.equal(b.context, SPREADSHEET_AUDIT_PK_V1_CONTEXT);
  assert.notEqual(a.target_id, b.target_id);
  assert.deepEqual(parseSpreadsheetAuditIdentityV1(a), [["left", "x:y"], ["right", "z"]]);
  assert.deepEqual(parseSpreadsheetAuditIdentityV1(b), [["left", "x"], ["right", "y:z"]]);
});

test("Issue #674: key insertion order and Unicode-equivalent distinct spellings are preserved", () => {
  const pk = { "é": "café", "e\u0301": "cafe\u0301", left: "a:b" };
  const reversed = Object.fromEntries(Object.entries(pk).reverse());
  const first = buildSpreadsheetAuditIdentityV1(pk);
  const second = buildSpreadsheetAuditIdentityV1(reversed);
  assert.deepEqual(second, first);
  assert.deepEqual(parseSpreadsheetAuditIdentityV1(first), [
    ["e\u0301", "cafe\u0301"], ["left", "a:b"], ["é", "café"],
  ]);
  assert.notEqual(
    first.target_id,
    buildSpreadsheetAuditIdentityV1({ "é": "cafe\u0301", "e\u0301": "café", left: "a:b" }).target_id,
  );
  assert.notEqual(
    first.target_id,
    buildSpreadsheetAuditIdentityV1({ "é": "café", left: "a:b" }).target_id,
  );
  assert.notEqual(
    first.target_id,
    buildSpreadsheetAuditIdentityV1({ "é": "café", "e\u0301": "cafe\u0301", RIGHT: "a:b" }).target_id,
  );
});

test("Issue #674: the same target_id string is NOT enough to classify historical logs", () => {
  const v1 = buildSpreadsheetAuditIdentityV1({ id: "record-a" });
  // A real legacy, single-column PK can equal a syntactically valid new ID.
  const legacy = spreadsheetRecordIdFromPk({ id: v1.target_id });
  assert.equal(legacy, v1.target_id);
  assert.ok(v1.target_id.startsWith(SPREADSHEET_AUDIT_PK_V1_PREFIX));
  assert.equal(parseSpreadsheetAuditIdentityV1({
    context: "admin_spreadsheet",
    target_id: legacy,
  }), null);
  assert.deepEqual(parseSpreadsheetAuditIdentityV1(v1), [["id", "record-a"]]);
});

test("Issue #674: invalid or noncanonical V1 representations fail closed", () => {
  for (const bad of [
    {}, { id: "" }, { id: "  " }, { id: "ab\0cd" }, { "bad\0key": "x" },
  ]) {
    assert.throws(() => buildSpreadsheetAuditIdentityV1(bad));
  }
  const invalid = [
    "spk:v2:[]",
    "spk:v1:[]",
    "spk:v1:null",
    "spk:v1:{\"id\":\"x\"}",
    "spk:v1:[[\"left\",\"x\"],[\"left\",\"y\"]]",
    "spk:v1:[[\"right\",\"z\"],[\"left\",\"x\"]]",
    "spk:v1:[[\"left\",\"x\",\"extra\"]]",
    "spk:v1:[[\"left\",\"ab\\u0000cd\"]]",
    "spk:v1:[[\"left\",\"x\"]] trailing",
  ];
  for (const target_id of invalid) {
    assert.equal(parseSpreadsheetAuditIdentityV1({
      context: SPREADSHEET_AUDIT_PK_V1_CONTEXT,
      target_id,
    }), null, target_id);
  }
  assert.equal(parseSpreadsheetAuditIdentityV1({
    context: "admin_spreadsheet",
    target_id: "x:y:z",
  }), null);
});

test("Issue #674: real SQLite audit lookup isolates new composite IDs and preserves legacy rows", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      table_name TEXT NOT NULL,
      target_id TEXT NOT NULL,
      context TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT
    ); CREATE INDEX audit_target_idx ON audit_logs (table_name, target_id);`);
    const ins = sqlite.prepare(
      "INSERT INTO audit_logs (id, table_name, target_id, context, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const pkA = { left: "x:y", right: "z" };
    const pkB = { left: "x", right: "y:z" };
    const a = buildSpreadsheetAuditIdentityV1(pkA);
    const b = buildSpreadsheetAuditIdentityV1(pkB);
    const legacy = spreadsheetRecordIdFromPk(pkA);
    ins.run("old-a", "video_events", legacy, "admin_spreadsheet", null, JSON.stringify(pkA));
    ins.run("old-b", "video_events", legacy, "admin_spreadsheet", null, JSON.stringify(pkB));
    ins.run("new-a", "video_events", a.target_id, a.context, null, JSON.stringify(pkA));
    ins.run("new-b", "video_events", b.target_id, b.context, JSON.stringify(pkB), null);
    const select = sqlite.prepare(
      "SELECT id, before_json, after_json FROM audit_logs WHERE table_name = ? AND context = ? AND target_id = ?",
    );
    assert.deepEqual(
      select.all("video_events", a.context, a.target_id).map(row => row.id),
      ["new-a"],
    );
    assert.deepEqual(
      select.all("video_events", b.context, b.target_id).map(row => row.id),
      ["new-b"],
    );
    assert.deepEqual(
      select.all("video_events", "admin_spreadsheet", legacy).map(row => row.id),
      ["old-a", "old-b"],
      "the legacy collision still exists; do not claim automatic history disambiguation",
    );
    assert.equal(
      select.get("video_events", a.context, a.target_id)?.after_json,
      JSON.stringify(pkA),
    );
    assert.equal(
      select.get("video_events", b.context, b.target_id)?.before_json,
      JSON.stringify(pkB),
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n,
      4,
      "historical audit rows are never rewritten",
    );
  } finally {
    sqlite.close();
  }
});

test("Issue #674: full legacy before/after snapshots distinguish colliding same-table PKs", () => {
  const target = { left: "x:y", right: "z" };
  const other = { left: "x", right: "y:z" };
  const lookup = buildSpreadsheetAuditHistoryLookup("video_events", target);
  assert.equal(lookup.legacy.target_id, "x:y:z");
  const mk = (id, before, after) => ({
    id, table_name: "video_events", context: "admin_spreadsheet",
    target_id: "x:y:z",
    before_json: before == null ? null : JSON.stringify(before),
    after_json: after == null ? null : JSON.stringify(after),
  });
  assert.equal(classifySpreadsheetAuditHistoryCandidate(lookup, mk("create", null, target)), "legacy_snapshot_exact");
  assert.equal(classifySpreadsheetAuditHistoryCandidate(lookup, mk("delete", target, null)), "legacy_snapshot_exact");
  assert.equal(classifySpreadsheetAuditHistoryCandidate(lookup, mk("update", target, { ...target, title: "updated" })), "legacy_snapshot_exact");
  assert.equal(classifySpreadsheetAuditHistoryCandidate(lookup, mk("colliding", null, other)), "other");
  assert.equal(classifySpreadsheetAuditHistoryCandidate(lookup, mk("opposite", other, other)), "other");
  assert.equal(classifySpreadsheetAuditHistoryCandidate(lookup, mk("mixed", target, other)), "legacy_ambiguous");
});

test("Issue #674: missing, redacted, numeric and malformed legacy snapshots never prove identity", () => {
  const lookup = buildSpreadsheetAuditHistoryLookup("video_events", { left: "x:y", right: "z" });
  const candidate = (before_json, after_json) => ({
    table_name: "video_events", context: "admin_spreadsheet",
    target_id: lookup.legacy.target_id, before_json, after_json,
  });
  for (const pair of [
    [null, null],
    [JSON.stringify({ left: "x:y" }), null],
    [JSON.stringify({ left: "x:y", right: "[REDACTED]" }), null],
    [JSON.stringify({ left: "x:y", right: 7 }), null],
    ["{bad json", null],
    ["null", null],
    [JSON.stringify(["x:y", "z"]), null],
    [JSON.stringify({ left: "x:y", right: "z" }), "unparseable"],
    [JSON.stringify({ left: "x:y", right: "z" }), JSON.stringify({ left: "x", right: "y:z" })],
  ]) {
    assert.equal(
      classifySpreadsheetAuditHistoryCandidate(lookup, candidate(...pair)),
      "legacy_ambiguous", JSON.stringify(pair),
    );
  }
});

test("Issue #674: context and table-name guard prevent V1-prefix and cross-table misattribution", () => {
  const lookup = buildSpreadsheetAuditHistoryLookup("video_events", { id: "v-a" });
  const asRow = (context, target_id, table_name = "video_events") => ({
    context, target_id, table_name, before_json: null, after_json: null,
  });
  assert.equal(classifySpreadsheetAuditHistoryCandidate(
    lookup, asRow(lookup.v1.context, lookup.v1.target_id)), "v1_exact");
  assert.equal(classifySpreadsheetAuditHistoryCandidate(
    lookup, asRow("admin_spreadsheet", lookup.v1.target_id)), "other");
  assert.equal(classifySpreadsheetAuditHistoryCandidate(
    lookup, asRow(lookup.v1.context, lookup.v1.target_id, "video_members")), "other");
  assert.equal(classifySpreadsheetAuditHistoryCandidate(
    lookup, asRow(lookup.v1.context, buildSpreadsheetAuditIdentityV1({ id: "other" }).target_id)), "other");
  const spoof = buildSpreadsheetAuditHistoryLookup("video_events", { id: lookup.v1.target_id });
  assert.equal(classifySpreadsheetAuditHistoryCandidate(
    spoof, asRow("admin_spreadsheet", lookup.v1.target_id)), "legacy_ambiguous");
});

test("Issue #674: bounded SQLite candidate fetch can classify mixed new/old history without rewriting it", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      table_name TEXT NOT NULL,
      context TEXT NOT NULL,
      target_id TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT
    ); CREATE INDEX audit_table_target ON audit_logs (table_name, target_id);`);
    const insert = sqlite.prepare(
      "INSERT INTO audit_logs (id, table_name, context, target_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const pkA = { left: "x:y", right: "z" };
    const pkB = { left: "x", right: "y:z" };
    const lookup = buildSpreadsheetAuditHistoryLookup("video_events", pkA);
    const v1Other = buildSpreadsheetAuditHistoryLookup("video_events", pkB);
    insert.run("old-match", "video_events", "admin_spreadsheet", "x:y:z", null, JSON.stringify(pkA));
    insert.run("old-collision", "video_events", "admin_spreadsheet", "x:y:z", null, JSON.stringify(pkB));
    insert.run("old-unknown", "video_events", "admin_spreadsheet", "x:y:z", null, "{}");
    insert.run("new-match", "video_events", lookup.v1.context, lookup.v1.target_id, null, JSON.stringify(pkA));
    insert.run("new-other", "video_events", v1Other.v1.context, v1Other.v1.target_id, null, JSON.stringify(pkB));
    insert.run("other-table", "video_members", "admin_spreadsheet", "x:y:z", null, JSON.stringify(pkA));

    // A future history endpoint could fetch both identity candidates in ONE
    // bounded statement. It must then separate ambiguous legacy rows instead
    // of rendering them as confirmed matches for one composite PK.
    const getCandidates = sqlite.prepare(`SELECT table_name, context, target_id, before_json, after_json
      FROM audit_logs WHERE table_name = ? AND (
        (context = ? AND target_id = ?) OR (context = ? AND target_id = ?))
      ORDER BY id LIMIT ?`);
    const rows = getCandidates.all(
      lookup.table_name, lookup.v1.context, lookup.v1.target_id,
      lookup.legacy.context, lookup.legacy.target_id, 10,
    );
    assert.equal(rows.length, 4);
    const tags = rows.map((row) => classifySpreadsheetAuditHistoryCandidate(lookup, row));
    assert.deepEqual(tags.sort(), [
      "legacy_ambiguous", "legacy_snapshot_exact", "other", "v1_exact",
    ].sort());
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 6);
  } finally {
    sqlite.close();
  }
});
