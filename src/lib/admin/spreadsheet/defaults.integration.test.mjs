import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { resolveSpreadsheetDefaultValue } from "./validation.ts";

test("SQLite defaults are materialized into the same insert snapshot", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE defaults (id TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 7, created_at INTEGER NOT NULL DEFAULT (unixepoch()))",
  );
  const count = resolveSpreadsheetDefaultValue({ defaultValue: "7" });
  const createdAt = resolveSpreadsheetDefaultValue({ defaultValue: "(unixepoch())" });
  db.prepare("INSERT INTO defaults (id, count, created_at) VALUES (?, ?, ?)").run(
    "row-1",
    count,
    createdAt,
  );
  assert.deepEqual({ ...db.prepare("SELECT * FROM defaults").get() }, {
    id: "row-1",
    count,
    created_at: createdAt,
  });
});
