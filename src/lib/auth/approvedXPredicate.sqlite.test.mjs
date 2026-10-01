import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { approvedXIdsWhere, approvedXIdsNotWhere } from "./approvedXPredicate.ts";

const staff = sqliteTable("event_staff", {
  id: text("id"), x_user_id: text("x_user_id"), event_id: text("event_id"),
});
const dialect = new SQLiteSyncDialect();
const migration = readFileSync(new URL("../../../migrations/0063_event_staff_account_lookup_index.sql", import.meta.url), "utf8");

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE event_staff (id TEXT PRIMARY KEY, x_user_id TEXT, event_id TEXT)");
  const insert = db.prepare("INSERT INTO event_staff VALUES (?, ?, ?)");
  for (let i = 0; i < 5000; i++) insert.run(`staff-${i}`, `x-${i}`, `event-${i}`);
  insert.run("null", null, "event-null");
  insert.run("quoted", "O'Reilly", "event-quote");
  return db;
}

function query(ids, negative = false) {
  const predicate = negative ? approvedXIdsNotWhere : approvedXIdsWhere;
  return dialect.sqlToQuery(sql`SELECT id FROM event_staff WHERE ${predicate(staff.x_user_id, ids)} ORDER BY id`);
}

test("approved X predicates preserve empty, NULL, duplicate and escaped membership across the 80-bind boundary", () => {
  const db = setup();
  try {
    for (const size of [0, 1, 80, 81, 500]) {
      const ids = Array.from({ length: size }, (_, i) => `x-${i}`);
      if (size) ids.push("  x-0 ", "", "O'Reilly");
      const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
      for (const negative of [false, true]) {
        const compiled = query(ids, negative);
        const actual = db.prepare(compiled.sql).all(...compiled.params).map((row) => row.id);
        const legacy = unique.length === 0
          ? negative ? "1" : "0"
          : `${negative ? "x_user_id IS NOT NULL AND NOT " : ""}EXISTS (
              SELECT 1 FROM json_each(?) WHERE CAST(value AS TEXT) = event_staff.x_user_id
            )`;
        const expected = db.prepare(`SELECT id FROM event_staff WHERE ${legacy} ORDER BY id`)
          .all(...(unique.length ? [JSON.stringify(unique)] : [])).map((row) => row.id);
        assert.deepEqual(actual, expected, `size=${size}, negative=${negative}`);
        assert.ok(compiled.params.length <= 80);
        if (unique.length > 80) assert.equal(compiled.params.length, 1);
      }
    }
  } finally { db.close(); }
});

test("account lookup changes from a full scan to an indexed SEARCH, including large JSON sets", () => {
  const db = setup();
  try {
    const small = query(["x-42"]);
    const explain = (compiled) => db.prepare(`EXPLAIN QUERY PLAN ${compiled.sql}`)
      .all(...compiled.params).map((row) => row.detail).join("\n");
    assert.match(explain(small), /SCAN event_staff/);
    db.exec(migration);
    for (const size of [1, 81, 500]) {
      const compiled = query(Array.from({ length: size }, (_, i) => `x-${i}`));
      const plan = explain(compiled);
      assert.match(plan, /SEARCH event_staff USING INDEX event_staff_x_event_idx/);
      assert.doesNotMatch(plan, /CORRELATED|SCAN event_staff/);
      assert.equal(db.prepare(compiled.sql).all(...compiled.params).length, size);
    }
    db.exec(migration); // additive migration can be retried
  } finally { db.close(); }
});
