import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { loadPermissionVideoRow } from "../src/video/permissionVideoRead.ts";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE videos (
      id TEXT PRIMARY KEY, title TEXT, primary_event_id TEXT,
      creator_x_user_id TEXT, submitted_by_user_id TEXT, visibility_status TEXT
    );
    INSERT INTO videos VALUES
      ('v1', 'Visible', 'e1', 'alice', NULL, 'public'),
      ('v2', 'Private', NULL, 'bob', 'actor2', 'private');
  `);
  const sqlText = [];
  const binding = {
    prepare(sql) {
      sqlText.push(sql);
      return {
        bind(...params) {
          return {
            async raw() {
              const stmt = sqlite.prepare(sql);
              stmt.setReturnArrays(true);
              try { return stmt.all(...params).map(row => [...row]); }
              finally { stmt.setReturnArrays(false); }
            },
          };
        },
      };
    },
  };
  return { sqlite, sqlText, db: drizzle(binding, { schema }) };
}

test("SA-082..084 minimal video read selects one requested video and preserves nullable columns", async () => {
  const f = fixture();
  try {
    const row = await loadPermissionVideoRow(f.db, "v1");
    assert.deepEqual({ ...row }, {
      id: "v1", title: "Visible", primary_event_id: "e1",
      creator_x_user_id: "alice", submitted_by_user_id: null,
      visibility_status: "public",
    });
    assert.equal(f.sqlText.length, 1);
    assert.match(f.sqlText[0], /WHERE/i);
    assert.match(f.sqlText[0], /LIMIT/i);
    assert.doesNotMatch(f.sqlText[0], /SELECT\s+\*/i);
  } finally { f.sqlite.close(); }
});

test("SA-082..084 missing video fails closed; opaque/hostile ID is bound", async () => {
  const f = fixture();
  try {
    assert.equal(await loadPermissionVideoRow(f.db, "missing"), null);
    assert.equal(await loadPermissionVideoRow(f.db, "v1' OR 1=1 --"), null);
    assert.equal(f.sqlText.length, 2);
    assert.ok(f.sqlText.every(sql => !sql.includes("1=1")));
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM videos").get().n, 2);
  } finally { f.sqlite.close(); }
});
